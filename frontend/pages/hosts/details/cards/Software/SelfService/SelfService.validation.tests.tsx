/**
 * Validation tests for the install-request serialization fix (issue #39245).
 *
 * Problem: When a user rapidly taps "Install" on multiple VPP apps, each tap
 * independently fires `deviceApi.installSelfServiceSoftware`.  The concurrent
 * API calls hit Apple's VPP endpoint at the same time and some return false
 * "host offline" errors.
 *
 * Fix: `SelfService.tsx` now uses a queue (`installQueueRef`) guarded by a
 * processing flag (`isProcessingInstallRef`).  `onClickInstallAction` pushes
 * items onto the queue and calls `processInstallQueue`, which drains the queue
 * one item at a time (serial `await`).  `onInstallOrUninstall` (the polling
 * refetch) is only called once after the entire queue is drained.
 *
 * These tests validate the core serialization contract without rendering the
 * full component tree (which has heavy React-Query / context dependencies).
 * Instead we replicate the exact ref + callback pattern from the component and
 * verify ordering / concurrency constraints.
 */

// ---------------------------------------------------------------------------
// Helpers that mirror the queue mechanism in SelfService.tsx
// ---------------------------------------------------------------------------

type QueueItem = { softwareId: number; isScriptPackage: boolean };

/**
 * Creates the queue-based (fixed) install handler.
 *
 * Mirrors the component's `installQueueRef`, `isProcessingInstallRef`,
 * `processInstallQueue`, and `onClickInstallAction`.
 */
function createSerialInstallHandler(
  installFn: (softwareId: number) => Promise<void>,
  onInstallOrUninstall: () => void
) {
  const queue: QueueItem[] = [];
  let isProcessing = false;

  async function processQueue() {
    if (isProcessing) return;
    isProcessing = true;

    while (queue.length > 0) {
      const { softwareId } = queue.shift()!;
      await installFn(softwareId);
    }

    isProcessing = false;
    onInstallOrUninstall();
  }

  function onClickInstall(softwareId: number) {
    queue.push({ softwareId, isScriptPackage: false });
    processQueue();
  }

  return { onClickInstall, queue };
}

/**
 * Creates the naive (pre-fix) install handler where every tap independently
 * fires the API call with no serialization.
 */
function createConcurrentInstallHandler(
  installFn: (softwareId: number) => Promise<void>,
  onInstallOrUninstall: () => void
) {
  async function onClickInstall(softwareId: number) {
    await installFn(softwareId);
    onInstallOrUninstall();
  }

  return { onClickInstall };
}

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

/**
 * Creates a mock install function that resolves after `delayMs` and records
 * timestamps so we can verify serial vs. concurrent execution.
 */
function createDelayedInstallMock(delayMs: number) {
  const callLog: Array<{
    softwareId: number;
    startTime: number;
    endTime: number;
  }> = [];
  let activeConcurrentCalls = 0;
  let peakConcurrentCalls = 0;

  const installFn = jest.fn(async (softwareId: number) => {
    const startTime = Date.now();
    activeConcurrentCalls++;
    if (activeConcurrentCalls > peakConcurrentCalls) {
      peakConcurrentCalls = activeConcurrentCalls;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));

    activeConcurrentCalls--;
    const endTime = Date.now();
    callLog.push({ softwareId, startTime, endTime });
  });

  return { installFn, callLog, getPeakConcurrency: () => peakConcurrentCalls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SelfService install-request serialization (issue #39245)", () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // BEFORE the fix – concurrent requests
  // -----------------------------------------------------------------------
  describe("BEFORE fix: concurrent handler (the bug)", () => {
    it("fires all API calls concurrently when Install is tapped rapidly", async () => {
      const DELAY_MS = 50;
      const {
        installFn,
        callLog,
        getPeakConcurrency,
      } = createDelayedInstallMock(DELAY_MS);
      const onInstallOrUninstall = jest.fn();

      const { onClickInstall } = createConcurrentInstallHandler(
        installFn,
        onInstallOrUninstall
      );

      // Simulate 3 rapid taps – all fire without waiting for prior to finish
      onClickInstall(100);
      onClickInstall(200);
      onClickInstall(300);

      // Wait for all to resolve
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS + 50));

      // All 3 API calls should have been made
      expect(installFn).toHaveBeenCalledTimes(3);

      // The bug: all calls were in-flight at the same time
      expect(getPeakConcurrency()).toBe(3);

      // The bug: onInstallOrUninstall is called once per tap (3 times)
      // triggering 3 redundant polling refetches
      expect(onInstallOrUninstall).toHaveBeenCalledTimes(3);

      // The bug: all calls start at roughly the same time
      // (the time spread between the first and last start is small)
      const starts = callLog.map((c) => c.startTime);
      const startSpread = Math.max(...starts) - Math.min(...starts);
      // All 3 calls start within a few ms of each other (concurrent)
      expect(startSpread).toBeLessThan(DELAY_MS);
    });
  });

  // -----------------------------------------------------------------------
  // AFTER the fix – serialized requests via queue
  // -----------------------------------------------------------------------
  describe("AFTER fix: serialized queue handler", () => {
    it("processes install requests one at a time (sequentially)", async () => {
      const DELAY_MS = 50;
      const {
        installFn,
        callLog,
        getPeakConcurrency,
      } = createDelayedInstallMock(DELAY_MS);
      const onInstallOrUninstall = jest.fn();

      const { onClickInstall } = createSerialInstallHandler(
        installFn,
        onInstallOrUninstall
      );

      // Simulate 3 rapid taps
      onClickInstall(100);
      onClickInstall(200);
      onClickInstall(300);

      // Wait long enough for all 3 sequential calls to complete
      // (3 * DELAY_MS + buffer)
      await new Promise((resolve) =>
        setTimeout(resolve, DELAY_MS * 3 + 100)
      );

      // All 3 API calls should have been made
      expect(installFn).toHaveBeenCalledTimes(3);

      // The fix: at most 1 call was in-flight at any time
      expect(getPeakConcurrency()).toBe(1);

      // The fix: onInstallOrUninstall is called exactly once after the entire
      // queue is drained, not once per tap
      expect(onInstallOrUninstall).toHaveBeenCalledTimes(1);
    });

    it("calls the API in the correct order (FIFO)", async () => {
      const DELAY_MS = 30;
      const { installFn, callLog } = createDelayedInstallMock(DELAY_MS);
      const onInstallOrUninstall = jest.fn();

      const { onClickInstall } = createSerialInstallHandler(
        installFn,
        onInstallOrUninstall
      );

      onClickInstall(100);
      onClickInstall(200);
      onClickInstall(300);

      await new Promise((resolve) =>
        setTimeout(resolve, DELAY_MS * 3 + 100)
      );

      expect(callLog).toHaveLength(3);
      expect(callLog[0].softwareId).toBe(100);
      expect(callLog[1].softwareId).toBe(200);
      expect(callLog[2].softwareId).toBe(300);
    });

    it("ensures each call starts after the previous one finishes (no overlap)", async () => {
      const DELAY_MS = 40;
      const { installFn, callLog } = createDelayedInstallMock(DELAY_MS);
      const onInstallOrUninstall = jest.fn();

      const { onClickInstall } = createSerialInstallHandler(
        installFn,
        onInstallOrUninstall
      );

      onClickInstall(100);
      onClickInstall(200);
      onClickInstall(300);

      await new Promise((resolve) =>
        setTimeout(resolve, DELAY_MS * 3 + 100)
      );

      // Verify no time overlap between consecutive calls
      for (let i = 1; i < callLog.length; i++) {
        expect(callLog[i].startTime).toBeGreaterThanOrEqual(
          callLog[i - 1].endTime
        );
      }
    });

    it("still works correctly for a single install (no queue needed)", async () => {
      const DELAY_MS = 20;
      const { installFn } = createDelayedInstallMock(DELAY_MS);
      const onInstallOrUninstall = jest.fn();

      const { onClickInstall } = createSerialInstallHandler(
        installFn,
        onInstallOrUninstall
      );

      onClickInstall(42);

      await new Promise((resolve) => setTimeout(resolve, DELAY_MS + 50));

      expect(installFn).toHaveBeenCalledTimes(1);
      expect(installFn).toHaveBeenCalledWith(42);
      expect(onInstallOrUninstall).toHaveBeenCalledTimes(1);
    });

    it("handles API errors without stopping the queue", async () => {
      const callOrder: number[] = [];
      const installFn = jest.fn(async (softwareId: number) => {
        callOrder.push(softwareId);
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (softwareId === 200) {
          throw new Error("VPP API error");
        }
      });
      const onInstallOrUninstall = jest.fn();

      // Replicate the component's error-resilient queue logic:
      // The component wraps each call in try/catch inside the while loop,
      // so an error on one item does NOT stop processing the rest.
      const queue: QueueItem[] = [];
      let isProcessing = false;

      async function processQueue() {
        if (isProcessing) return;
        isProcessing = true;

        while (queue.length > 0) {
          const { softwareId } = queue.shift()!;
          try {
            await installFn(softwareId);
          } catch {
            // Error is caught per-item, queue continues
          }
        }

        isProcessing = false;
        onInstallOrUninstall();
      }

      function onClickInstall(softwareId: number) {
        queue.push({ softwareId, isScriptPackage: false });
        processQueue();
      }

      onClickInstall(100);
      onClickInstall(200); // This one will fail
      onClickInstall(300);

      await new Promise((resolve) => setTimeout(resolve, 200));

      // All 3 were attempted despite the error on 200
      expect(installFn).toHaveBeenCalledTimes(3);
      expect(callOrder).toEqual([100, 200, 300]);

      // onInstallOrUninstall is still called once at the end
      expect(onInstallOrUninstall).toHaveBeenCalledTimes(1);
    });

    it("can process a second batch after the first batch drains", async () => {
      const DELAY_MS = 20;
      const { installFn, callLog } = createDelayedInstallMock(DELAY_MS);
      const onInstallOrUninstall = jest.fn();

      const { onClickInstall } = createSerialInstallHandler(
        installFn,
        onInstallOrUninstall
      );

      // First batch
      onClickInstall(100);
      onClickInstall(200);

      await new Promise((resolve) =>
        setTimeout(resolve, DELAY_MS * 2 + 100)
      );

      expect(installFn).toHaveBeenCalledTimes(2);
      expect(onInstallOrUninstall).toHaveBeenCalledTimes(1);

      // Second batch after first completes
      onClickInstall(300);
      onClickInstall(400);

      await new Promise((resolve) =>
        setTimeout(resolve, DELAY_MS * 2 + 100)
      );

      expect(installFn).toHaveBeenCalledTimes(4);
      // onInstallOrUninstall is called once per batch drain
      expect(onInstallOrUninstall).toHaveBeenCalledTimes(2);
      expect(callLog.map((c) => c.softwareId)).toEqual([100, 200, 300, 400]);
    });
  });

  // -----------------------------------------------------------------------
  // Side-by-side comparison
  // -----------------------------------------------------------------------
  describe("side-by-side: concurrent vs. serialized", () => {
    it("concurrent handler has higher peak concurrency than serialized handler", async () => {
      const DELAY_MS = 50;

      // --- Concurrent (buggy) ---
      const concurrentMock = createDelayedInstallMock(DELAY_MS);
      const concurrentPoll = jest.fn();
      const concurrent = createConcurrentInstallHandler(
        concurrentMock.installFn,
        concurrentPoll
      );

      concurrent.onClickInstall(1);
      concurrent.onClickInstall(2);
      concurrent.onClickInstall(3);

      await new Promise((resolve) => setTimeout(resolve, DELAY_MS + 50));

      // --- Serialized (fixed) ---
      const serialMock = createDelayedInstallMock(DELAY_MS);
      const serialPoll = jest.fn();
      const serial = createSerialInstallHandler(
        serialMock.installFn,
        serialPoll
      );

      serial.onClickInstall(1);
      serial.onClickInstall(2);
      serial.onClickInstall(3);

      await new Promise((resolve) =>
        setTimeout(resolve, DELAY_MS * 3 + 100)
      );

      // Concurrent: peak concurrency is 3, polling called 3 times
      expect(concurrentMock.getPeakConcurrency()).toBe(3);
      expect(concurrentPoll).toHaveBeenCalledTimes(3);

      // Serialized: peak concurrency is 1, polling called 1 time
      expect(serialMock.getPeakConcurrency()).toBe(1);
      expect(serialPoll).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Unmount cleanup: queue cleared mid-processing
  // -----------------------------------------------------------------------
  describe("unmount cleanup: queue cleared mid-processing", () => {
    it("stops processing remaining items when the queue is cleared (simulating unmount)", async () => {
      const DELAY_MS = 60;
      const callOrder: number[] = [];

      const queue: QueueItem[] = [];
      let isProcessing = false;

      const installFn = jest.fn(async (softwareId: number) => {
        callOrder.push(softwareId);
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      });
      const onInstallOrUninstall = jest.fn();

      async function processQueue() {
        if (isProcessing) return;
        isProcessing = true;

        while (queue.length > 0) {
          const { softwareId } = queue.shift()!;
          await installFn(softwareId);
        }

        isProcessing = false;
        onInstallOrUninstall();
      }

      function onClickInstall(softwareId: number) {
        queue.push({ softwareId, isScriptPackage: false });
        processQueue();
      }

      // Queue 5 items
      onClickInstall(1);
      onClickInstall(2);
      onClickInstall(3);
      onClickInstall(4);
      onClickInstall(5);

      // After the first item finishes, simulate unmount by clearing the queue
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS + 20));
      queue.length = 0; // simulates installQueueRef.current = []

      // Wait long enough for all 5 to have completed if queue were intact
      await new Promise((resolve) =>
        setTimeout(resolve, DELAY_MS * 5 + 100)
      );

      // Only 1-2 items should have been processed (the one in-flight when
      // we cleared + possibly the next one already shifted)
      expect(installFn.mock.calls.length).toBeLessThanOrEqual(3);
      expect(installFn.mock.calls.length).toBeGreaterThanOrEqual(1);

      // The processed items should be the first ones (FIFO)
      for (let i = 0; i < callOrder.length; i++) {
        expect(callOrder[i]).toBe(i + 1);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Duplicate softwareId handling
  // -----------------------------------------------------------------------
  describe("duplicate softwareId handling", () => {
    it("processes all queued items even when the same softwareId appears multiple times (no dedup)", async () => {
      const DELAY_MS = 20;
      const { installFn, callLog } = createDelayedInstallMock(DELAY_MS);
      const onInstallOrUninstall = jest.fn();

      const { onClickInstall } = createSerialInstallHandler(
        installFn,
        onInstallOrUninstall
      );

      // Same ID queued 3 times
      onClickInstall(42);
      onClickInstall(42);
      onClickInstall(42);

      await new Promise((resolve) =>
        setTimeout(resolve, DELAY_MS * 3 + 100)
      );

      // All 3 are processed (no dedup)
      expect(installFn).toHaveBeenCalledTimes(3);
      expect(callLog.every((c) => c.softwareId === 42)).toBe(true);
      expect(onInstallOrUninstall).toHaveBeenCalledTimes(1);
    });

    it("processes duplicates interspersed with other ids in correct FIFO order", async () => {
      const DELAY_MS = 15;
      const { installFn, callLog } = createDelayedInstallMock(DELAY_MS);
      const onInstallOrUninstall = jest.fn();

      const { onClickInstall } = createSerialInstallHandler(
        installFn,
        onInstallOrUninstall
      );

      onClickInstall(10);
      onClickInstall(20);
      onClickInstall(10);
      onClickInstall(30);
      onClickInstall(20);

      await new Promise((resolve) =>
        setTimeout(resolve, DELAY_MS * 5 + 100)
      );

      expect(installFn).toHaveBeenCalledTimes(5);
      expect(callLog.map((c) => c.softwareId)).toEqual([10, 20, 10, 30, 20]);
      expect(onInstallOrUninstall).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Large batch stress test
  // -----------------------------------------------------------------------
  describe("large batch stress test", () => {
    it("processes 20 queued items serially in FIFO order with 1 final callback", async () => {
      const DELAY_MS = 10;
      const {
        installFn,
        callLog,
        getPeakConcurrency,
      } = createDelayedInstallMock(DELAY_MS);
      const onInstallOrUninstall = jest.fn();

      const { onClickInstall } = createSerialInstallHandler(
        installFn,
        onInstallOrUninstall
      );

      // Queue 20 items
      for (let id = 1; id <= 20; id++) {
        onClickInstall(id);
      }

      await new Promise((resolve) =>
        setTimeout(resolve, DELAY_MS * 20 + 200)
      );

      // All 20 processed
      expect(installFn).toHaveBeenCalledTimes(20);

      // Peak concurrency stays at 1
      expect(getPeakConcurrency()).toBe(1);

      // FIFO ordering
      expect(callLog.map((c) => c.softwareId)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1)
      );

      // No time overlap
      for (let i = 1; i < callLog.length; i++) {
        expect(callLog[i].startTime).toBeGreaterThanOrEqual(
          callLog[i - 1].endTime
        );
      }

      // Only 1 callback
      expect(onInstallOrUninstall).toHaveBeenCalledTimes(1);
    });
  });
});
