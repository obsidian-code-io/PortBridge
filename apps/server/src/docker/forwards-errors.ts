/** Typed, catchable errors for the forward engine. Routes map these to UX. */

export class ForwardError extends Error {}

export class TargetNotFoundError extends ForwardError {
  override readonly name = "TargetNotFoundError";
}

export class InvalidTargetError extends ForwardError {
  override readonly name = "InvalidTargetError";
}

export class NonAttachableNetworkError extends ForwardError {
  override readonly name = "NonAttachableNetworkError";
}

export class NoFreePortError extends ForwardError {
  override readonly name = "NoFreePortError";
}

export class HostPortUnavailableError extends ForwardError {
  override readonly name = "HostPortUnavailableError";
}

export class MaxForwardsReachedError extends ForwardError {
  override readonly name = "MaxForwardsReachedError";
}

export class ForwardNotFoundError extends ForwardError {
  override readonly name = "ForwardNotFoundError";
}
