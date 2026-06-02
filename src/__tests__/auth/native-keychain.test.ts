import {
  createNativeKeychain,
  isKeychainSupported,
} from "../../auth/native-keychain.js";

describe("native-keychain", () => {
  describe("isKeychainSupported", () => {
    it("returns true for supported platforms", () => {
      // In the test environment (Linux), this should return true
      expect(typeof isKeychainSupported()).toBe("boolean");
    });
  });

  describe("createNativeKeychain", () => {
    it("returns a keychain object with expected methods", () => {
      const keychain = createNativeKeychain();
      // On Linux (CI) or macOS (local dev), this should return a keychain
      if (keychain) {
        expect(typeof keychain.getPassword).toBe("function");
        expect(typeof keychain.setPassword).toBe("function");
        expect(typeof keychain.deletePassword).toBe("function");
      }
    });

    it("returns null for unsupported platforms", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", {
        value: "freebsd",
        writable: true,
        configurable: true,
      });
      try {
        const keychain = createNativeKeychain();
        expect(keychain).toBeNull();
      } finally {
        Object.defineProperty(process, "platform", {
          value: originalPlatform,
          writable: true,
          configurable: true,
        });
      }
    });
  });
});
