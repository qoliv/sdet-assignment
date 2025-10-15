import { sleep } from "../../utils/time";

describe("time helpers", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should resolve only after the specified delay elapses", async () => {
    const onResolved = jest.fn();
    const promise = sleep(200);
    promise.then(onResolved);

    await jest.advanceTimersByTimeAsync(199);
    expect(onResolved).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(onResolved).toHaveBeenCalledTimes(1);
    await expect(promise).resolves.toBeUndefined();
  });
});
