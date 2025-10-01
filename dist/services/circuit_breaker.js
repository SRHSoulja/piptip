class CircuitBreaker {
  constructor(failureThreshold = 5, timeout = 3e4, resetTimeout = 6e4) {
    this.failureThreshold = failureThreshold;
    this.timeout = timeout;
    this.resetTimeout = resetTimeout;
  }
  failureCount = 0;
  lastFailureTime = 0;
  state = "CLOSED";
  async execute(operation) {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = "HALF_OPEN";
        console.log("Circuit breaker: transitioning to HALF_OPEN");
      } else {
        throw new Error("Circuit breaker is OPEN - operation rejected");
      }
    }
    try {
      const result = await Promise.race([
        operation(),
        new Promise(
          (_, reject) => setTimeout(() => reject(new Error("Operation timeout")), this.timeout)
        )
      ]);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  onSuccess() {
    this.failureCount = 0;
    this.state = "CLOSED";
  }
  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      console.error(`Circuit breaker OPENED after ${this.failureCount} failures`);
    }
  }
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime
    };
  }
}
const dbCircuitBreaker = new CircuitBreaker(3, 5e3, 3e4);
const discordCircuitBreaker = new CircuitBreaker(5, 8e3, 6e4);
export {
  CircuitBreaker,
  dbCircuitBreaker,
  discordCircuitBreaker
};
//# sourceMappingURL=circuit_breaker.js.map
