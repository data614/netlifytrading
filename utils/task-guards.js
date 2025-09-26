export function createLatestPromiseRunner() {
  let invocationId = 0;
  return async (task) => {
    const currentId = ++invocationId;
    try {
      const result = await task();
      if (currentId !== invocationId) {
        return { cancelled: true, result };
      }
      return { cancelled: false, result };
    } catch (error) {
      if (currentId !== invocationId) {
        return { cancelled: true, error };
      }
      throw error;
    }
  };
}

export function createOperationTokenSource() {
  let token = 0;
  return {
    next() {
      token += 1;
      return token;
    },
    isCurrent(value) {
      return value === token;
    },
    current() {
      return token;
    },
  };
}
