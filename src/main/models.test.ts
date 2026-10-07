import { describe, expect, it } from 'vitest'
import { bandwidthGBps, recommendChat } from './models'

const pick = (ramGB: number, chip: string, ctx = 4096) => recommendChat(ramGB, chip, ctx).tag
describe('chat model recommendation', () => {
  it('reads chip tiers from the brand string', () => {
    expect(bandwidthGBps('Apple M1')).toBe(68); expect(bandwidthGBps('Apple M3 Max')).toBe(400); expect(bandwidthGBps('Apple M9 Ultra')).toBe(800)
  })
  it('gives an 8 GB base Mac the small instruct model', () => { expect(pick(8, 'Apple M1')).toBe('qwen3:4b-instruct') })
  it('keeps a base chip off a dense model it would run too slowly', () => { expect(pick(16, 'Apple M1', 8192)).toBe('qwen3:4b-instruct') })
  it('steps up with bandwidth and memory', () => {
    expect(pick(16, 'Apple M1 Pro', 8192)).toBe('gemma3:12b')
    expect(pick(32, 'Apple M2', 16384)).toBe('qwen3:30b-instruct')
    expect(pick(256, 'Apple M3 Ultra', 16384)).toBe('qwen3:235b-instruct')
  })
  it('never picks a reasoning model', () => {
    for (const ram of [8, 16, 24, 32, 64, 128, 512]) expect(pick(ram, 'Apple M4 Max')).not.toMatch(/r1|thinking|^qwen3:\d+b$/)
  })
})
