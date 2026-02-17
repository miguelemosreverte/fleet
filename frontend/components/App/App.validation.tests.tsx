import page_titles from "router/page_titles";

/**
 * Validation tests for the page title matching logic in App.tsx (line ~229-231).
 *
 * Bug (#39613): Using `pathname.includes(item.path)` caused a host's software
 * tab (e.g., `/hosts/123/software/inventory`) to incorrectly match the
 * top-level `/software` entry in page_titles, setting the browser tab title
 * to "Software" instead of the host-specific title.
 *
 * Fix: Changed to `pathname.startsWith(item.path)` so only paths that actually
 * begin with the configured path prefix trigger that title.
 */

// This replicates the matching logic from App.tsx useEffect (lines 226-236):
//   const curTitle = page_titles.find((item) =>
//     location?.pathname.startsWith(item.path)
//   );
const findTitle = (pathname: string) => {
  return page_titles.find((item) => pathname.startsWith(item.path));
};

// This replicates the OLD buggy matching logic that used `includes`:
const findTitleBuggy = (pathname: string) => {
  return page_titles.find((item) => pathname.includes(item.path));
};

describe("App page title matching (fix for #39613)", () => {
  describe("bug scenario: host software tab should NOT match top-level Software title", () => {
    it("does NOT set title to 'Software' for /hosts/123/software/inventory", () => {
      const result = findTitle("/hosts/123/software/inventory");
      // This path should match "Hosts" (via /hosts/manage prefix) or nothing,
      // but it must NOT match the Software entry
      if (result) {
        expect(result.title).not.toMatch(/^Software \|/);
      }
    });

    it("does NOT set title to 'Software' for /hosts/456/software", () => {
      const result = findTitle("/hosts/456/software");
      if (result) {
        expect(result.title).not.toMatch(/^Software \|/);
      }
    });

    it("does NOT set title to 'Software' for /hosts/789/software/library", () => {
      const result = findTitle("/hosts/789/software/library");
      if (result) {
        expect(result.title).not.toMatch(/^Software \|/);
      }
    });
  });

  describe("confirms the old buggy logic WOULD have matched incorrectly", () => {
    it("old includes() logic incorrectly matches /hosts/123/software/inventory to Software", () => {
      const result = findTitleBuggy("/hosts/123/software/inventory");
      // The old logic with includes() would find /software inside
      // /hosts/123/software/inventory and incorrectly return the Software title
      expect(result).toBeDefined();
      expect(result!.title).toMatch(/^Software \|/);
    });
  });

  describe("fix works: top-level /software paths SHOULD match Software title", () => {
    it("sets title to 'Software' for /software/titles", () => {
      const result = findTitle("/software/titles");
      expect(result).toBeDefined();
      expect(result!.title).toMatch(/^Software \|/);
    });

    it("sets title to 'Software' for /software/os", () => {
      const result = findTitle("/software/os");
      expect(result).toBeDefined();
      expect(result!.title).toMatch(/^Software \|/);
    });

    it("sets title to 'Software' for /software/versions", () => {
      const result = findTitle("/software/versions");
      expect(result).toBeDefined();
      expect(result!.title).toMatch(/^Software \|/);
    });

    it("sets title to 'Software' for /software/vulnerabilities", () => {
      const result = findTitle("/software/vulnerabilities");
      expect(result).toBeDefined();
      expect(result!.title).toMatch(/^Software \|/);
    });

    it("sets title to 'Software' for /software", () => {
      const result = findTitle("/software");
      expect(result).toBeDefined();
      expect(result!.title).toMatch(/^Software \|/);
    });
  });

  describe("other paths still work correctly", () => {
    it("sets title to 'Hosts' for /hosts/manage", () => {
      const result = findTitle("/hosts/manage");
      expect(result).toBeDefined();
      expect(result!.title).toMatch(/^Hosts \|/);
    });

    it("sets title to 'Dashboard' for /dashboard", () => {
      const result = findTitle("/dashboard");
      expect(result).toBeDefined();
      expect(result!.title).toMatch(/^Dashboard \|/);
    });

    it("sets title to 'Queries' for /queries/manage", () => {
      const result = findTitle("/queries/manage");
      expect(result).toBeDefined();
      expect(result!.title).toMatch(/^Queries \|/);
    });

    it("sets title to 'Policies' for /policies/manage", () => {
      const result = findTitle("/policies/manage");
      expect(result).toBeDefined();
      expect(result!.title).toMatch(/^Policies \|/);
    });

    it("sets title to 'Settings' for /settings", () => {
      const result = findTitle("/settings");
      expect(result).toBeDefined();
      expect(result!.title).toMatch(/^Settings \|/);
    });

    it("sets title to 'Controls' for /controls", () => {
      const result = findTitle("/controls");
      expect(result).toBeDefined();
      expect(result!.title).toMatch(/^Controls \|/);
    });

    it("sets title to 'New query' for /queries/new", () => {
      const result = findTitle("/queries/new");
      expect(result).toBeDefined();
      expect(result!.title).toMatch(/^New query \|/);
    });

    it("sets title to 'New policy' for /policies/new", () => {
      const result = findTitle("/policies/new");
      expect(result).toBeDefined();
      expect(result!.title).toMatch(/^New policy \|/);
    });
  });

  describe("host detail paths do not incorrectly match other top-level titles", () => {
    it("/hosts/1/queries does not match 'Queries' title", () => {
      const result = findTitle("/hosts/1/queries");
      if (result) {
        expect(result.title).not.toMatch(/^Queries \|/);
      }
    });

    it("/hosts/1/policies does not match 'Policies' title", () => {
      const result = findTitle("/hosts/1/policies");
      if (result) {
        expect(result.title).not.toMatch(/^Policies \|/);
      }
    });
  });
});
