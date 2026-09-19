import { describe, expect, it } from 'vitest'
import { phraseKey } from './normalize'
describe('phraseKey',()=>{it('normalizes punctuation, case, and whitespace in one place',()=>{expect(phraseKey("  It's—A  TEST! ")).toBe("it'sa test")})})
