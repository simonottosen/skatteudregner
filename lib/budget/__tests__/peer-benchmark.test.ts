import { describe, it, expect } from "vitest"
import { comparePeers, peerMonthlyByCategory } from "../peer-benchmark"

const assumptions = { adults: 2, children: 0, cars: 1 }

describe("peerMonthlyByCategory", () => {
  it("produces positive peer totals for comparable categories", () => {
    const peer = peerMonthlyByCategory(assumptions)
    expect((peer.get("mad") ?? 0)).toBeGreaterThan(0)
    expect((peer.get("transport") ?? 0)).toBeGreaterThan(0)
    // No children → no childcare baseline.
    expect(peer.get("boern") ?? 0).toBe(0)
  })
})

describe("comparePeers", () => {
  it("flags categories where the user spends significantly more", () => {
    const peer = peerMonthlyByCategory(assumptions)
    const mad = peer.get("mad") ?? 0
    const user = new Map<string, number>([["mad", mad * 2]])
    const res = comparePeers(assumptions, user)
    const food = res.find((r) => r.categoryId === "mad")
    expect(food?.direction).toBe("more")
    expect(food?.ratio).toBeGreaterThanOrEqual(1.3)
  })

  it("flags categories where the user spends significantly less", () => {
    const peer = peerMonthlyByCategory(assumptions)
    const transport = peer.get("transport") ?? 0
    const user = new Map<string, number>([["transport", Math.round(transport * 0.4)]])
    const res = comparePeers(assumptions, user)
    const t = res.find((r) => r.categoryId === "transport")
    expect(t?.direction).toBe("less")
    expect(t?.ratio).toBeLessThanOrEqual(0.7)
  })

  it("does not flag spending close to the peer average", () => {
    const peer = peerMonthlyByCategory(assumptions)
    const mad = peer.get("mad") ?? 0
    const user = new Map<string, number>([["mad", mad]])
    expect(comparePeers(assumptions, user)).toHaveLength(0)
  })

  it("ignores housing and savings even with large deviations", () => {
    const user = new Map<string, number>([
      ["bolig", 50000],
      ["opsparing", 20000],
    ])
    expect(comparePeers(assumptions, user)).toHaveLength(0)
  })

  it("skips categories with no user spend", () => {
    const res = comparePeers(assumptions, new Map())
    expect(res).toHaveLength(0)
  })

  it("orders results by largest absolute deviation first", () => {
    const peer = peerMonthlyByCategory(assumptions)
    const user = new Map<string, number>([
      ["mad", (peer.get("mad") ?? 0) * 2],
      ["abonnementer", (peer.get("abonnementer") ?? 0) * 3],
    ])
    const res = comparePeers(assumptions, user)
    expect(res.length).toBeGreaterThanOrEqual(2)
    const diffs = res.map((r) => Math.abs(r.userMonthly - r.peerMonthly))
    expect(diffs[0]).toBeGreaterThanOrEqual(diffs[1])
  })
})
