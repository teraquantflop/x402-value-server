import { describe, expect, it } from "vitest";
import {
  isEvmAddress,
  isSvmAddress,
  isSvmNetworkId,
  NETWORK_MAP,
} from "../src/config.js";

describe("address detection", () => {
  it("accepts EVM addresses", () => {
    expect(isEvmAddress("0x1111111111111111111111111111111111111111")).toBe(
      true,
    );
  });

  it("accepts Solana base58 addresses", () => {
    expect(
      isSvmAddress("DCi9X5mmacNGLeJvCw9fdWgX3G8V4QquDn4EuXATkcYr"),
    ).toBe(true);
  });

  it("rejects EVM-looking strings as Solana", () => {
    expect(
      isSvmAddress("0x1111111111111111111111111111111111111111"),
    ).toBe(false);
  });
});

describe("network map", () => {
  it("maps solana alias to mainnet CAIP-2", () => {
    expect(NETWORK_MAP.solana).toBe(
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    );
  });

  it("maps solana-devnet alias", () => {
    expect(NETWORK_MAP["solana-devnet"]).toBe(
      "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    );
  });

  it("detects SVM network ids", () => {
    expect(isSvmNetworkId(NETWORK_MAP.solana)).toBe(true);
    expect(isSvmNetworkId(NETWORK_MAP.base)).toBe(false);
  });
});
