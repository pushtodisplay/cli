import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SERVICE_NAME = "pushtodisplay-cli";

/**
 * Portable keychain access using OS-native commands.
 *
 * - macOS  → `security` CLI (Keychain Services)
 * - Linux  → `secret-tool` (libsecret / GNOME Keyring / KDE Wallet)
 * - Windows → PowerShell + Windows Credential Manager (DPAPI)
 *
 * This replaces the deprecated `keytar` native Node module, which
 * required node-gyp compilation and frequently failed on newer
 * macOS versions and Apple Silicon.
 */

// ---------------------------------------------------------------------------
// macOS – Keychain via `security` CLI
// ---------------------------------------------------------------------------

async function macGetPassword(account: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      SERVICE_NAME,
      "-a",
      account,
      "-w", // output only the password
    ]);
    return stdout.trimEnd();
  } catch {
    return null; // item not found or keychain locked
  }
}

async function macSetPassword(account: string, password: string): Promise<void> {
  // Delete first (ignore errors if it doesn't exist)
  try {
    await execFileAsync("security", [
      "delete-generic-password",
      "-s",
      SERVICE_NAME,
      "-a",
      account,
    ]);
  } catch {
    // ignore – may not exist
  }

  await execFileAsync("security", [
    "add-generic-password",
    "-s",
    SERVICE_NAME,
    "-a",
    account,
    "-w",
    password,
    "-U", // update if exists (belt-and-suspenders)
  ]);
}

async function macDeletePassword(account: string): Promise<void> {
  try {
    await execFileAsync("security", [
      "delete-generic-password",
      "-s",
      SERVICE_NAME,
      "-a",
      account,
    ]);
  } catch {
    // ignore – may not exist
  }
}

// ---------------------------------------------------------------------------
// Linux – libsecret via `secret-tool`
// ---------------------------------------------------------------------------

async function linuxGetPassword(account: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("secret-tool", [
      "lookup",
      "service",
      SERVICE_NAME,
      "account",
      account,
    ]);
    return stdout.trimEnd() || null;
  } catch {
    return null;
  }
}

async function linuxSetPassword(
  account: string,
  password: string,
): Promise<void> {
  // secret-tool reads the secret from stdin
  const promise = execFileAsync("secret-tool", [
    "store",
    "--label",
    `${SERVICE_NAME} (${account})`,
    "service",
    SERVICE_NAME,
    "account",
    account,
  ]);

  // Write the password to stdin of the child process
  promise.child.stdin?.write(password);
  promise.child.stdin?.end();
  await promise;
}

async function linuxDeletePassword(account: string): Promise<void> {
  try {
    await execFileAsync("secret-tool", [
      "clear",
      "service",
      SERVICE_NAME,
      "account",
      account,
    ]);
  } catch {
    // ignore – may not exist
  }
}

// ---------------------------------------------------------------------------
// Windows – Credential Manager via PowerShell
// ---------------------------------------------------------------------------

function winTargetName(account: string): string {
  return `${SERVICE_NAME}/${account}`;
}

/**
 * Escape a string for safe inclusion in a PowerShell single-quoted literal.
 * Single quotes inside the value are doubled ('').
 */
function escapePsString(s: string): string {
  return s.replace(/'/g, "''");
}

async function winGetPassword(account: string): Promise<string | null> {
  const target = escapePsString(winTargetName(account));
  const script = `
    $ErrorActionPreference = 'Stop'
    Add-Type -TypeDefinition @"
    using System;
    using System.Runtime.InteropServices;
    using System.Text;
    public class CredManager {
      [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
      public static extern bool CredReadW(string target, int type, int flags, out IntPtr cred);
      [DllImport("advapi32.dll")]
      public static extern void CredFree(IntPtr cred);
      [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
      public struct CREDENTIAL {
        public int Flags; public int Type; public string TargetName;
        public string Comment; public long LastWritten; public int CredentialBlobSize;
        public IntPtr CredentialBlob; public int Persist; public int AttributeCount;
        public IntPtr Attributes; public string TargetAlias; public string UserName;
      }
      public static string Read(string target) {
        IntPtr ptr;
        if (!CredReadW(target, 1, 0, out ptr)) return null;
        try {
          var cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
          return Marshal.PtrToStringUni(cred.CredentialBlob, cred.CredentialBlobSize / 2);
        } finally { CredFree(ptr); }
      }
    }
"@
    $r = [CredManager]::Read('${target}')
    if ($r -ne $null) { [Console]::Out.Write($r) }
  `;

  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    return stdout || null;
  } catch {
    return null;
  }
}

async function winSetPassword(
  account: string,
  password: string,
): Promise<void> {
  const target = escapePsString(winTargetName(account));
  // Read password from stdin to avoid exposing it in process arguments
  const script = `
    $ErrorActionPreference = 'Stop'
    $pass = [Console]::In.ReadToEnd()
    Add-Type -TypeDefinition @"
    using System;
    using System.Runtime.InteropServices;
    using System.Text;
    public class CredWriter {
      [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
      public struct CREDENTIAL {
        public int Flags; public int Type; public string TargetName;
        public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize; public IntPtr CredentialBlob;
        public int Persist; public int AttributeCount;
        public IntPtr Attributes; public string TargetAlias; public string UserName;
      }
      [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
      public static extern bool CredWriteW(ref CREDENTIAL cred, int flags);
      public static void Write(string target, string user, string secret) {
        var bytes = Encoding.Unicode.GetBytes(secret);
        var blob = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, blob, bytes.Length);
        var cred = new CREDENTIAL();
        cred.Type = 1;
        cred.TargetName = target;
        cred.UserName = user;
        cred.CredentialBlob = blob;
        cred.CredentialBlobSize = bytes.Length;
        cred.Persist = 2;
        try { if (!CredWriteW(ref cred, 0)) throw new Exception("CredWrite failed"); }
        finally { Marshal.FreeHGlobal(blob); }
      }
    }
"@
    [CredWriter]::Write('${target}', '${escapePsString(account)}', $pass)
  `;

  const promise = execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);

  promise.child.stdin?.write(password);
  promise.child.stdin?.end();
  await promise;
}

async function winDeletePassword(account: string): Promise<void> {
  const target = winTargetName(account);
  try {
    await execFileAsync("cmdkey.exe", [`/delete:${target}`]);
  } catch {
    // ignore – may not exist
  }
}

// ---------------------------------------------------------------------------
// Public API – dispatch by platform
// ---------------------------------------------------------------------------

export interface NativeKeychain {
  getPassword(account: string): Promise<string | null>;
  setPassword(account: string, password: string): Promise<void>;
  deletePassword(account: string): Promise<void>;
}

export function isKeychainSupported(): boolean {
  return (
    process.platform === "darwin" ||
    process.platform === "linux" ||
    process.platform === "win32"
  );
}

export function createNativeKeychain(): NativeKeychain | null {
  switch (process.platform) {
    case "darwin":
      return {
        getPassword: macGetPassword,
        setPassword: macSetPassword,
        deletePassword: macDeletePassword,
      };
    case "linux":
      return {
        getPassword: linuxGetPassword,
        setPassword: linuxSetPassword,
        deletePassword: linuxDeletePassword,
      };
    case "win32":
      return {
        getPassword: winGetPassword,
        setPassword: winSetPassword,
        deletePassword: winDeletePassword,
      };
    default:
      return null;
  }
}
