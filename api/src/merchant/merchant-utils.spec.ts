import {it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import {hashPassword,checkPassword,credentials,csvCell,filters} from './merchant-utils.js';
it('salts and verifies passwords',async()=>{const p=randomBytes(24).toString('hex'),a=await hashPassword(p),b=await hashPassword(p);expect(a===b).toBe(false);expect(await checkPassword(p,a)).toBe(true);expect(await checkPassword('wrong-password',a)).toBe(false);});
it('validates credentials and dates',()=>{expect(()=>credentials({email:'bad',password:'short'})).toThrow();expect(()=>filters({from:'2026-02-30'},'m')).toThrow();expect(()=>filters({from:'2026-04-02',to:'2026-04-01'},'m')).toThrow();});
it.each(['=SUM(1,2)','+CMD','@formula','-formula',' \t=bad'])('escapes CSV formula prefix %s',v=>expect(csvCell(v).startsWith('"\'')).toBe(true));
it('parameterizes search and escapes CSV quotes',()=>{expect(filters({search:"x' OR true"},'m').where).not.toContain("x'");expect(csvCell('a"b')).toBe('"a""b"');});
