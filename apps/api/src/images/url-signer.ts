import { createHmac, timingSafeEqual } from 'crypto';

export type Variant = 'full' | 'thumb';

/**
 * Short-lived signed URLs let <img> tags, print views and the public quotation page load private files
 * without sending an Authorization header. The signature covers the file id, variant and expiry.
 */
export class UrlSigner {
  constructor(private readonly secret: string) {}

  private mac(id: string, variant: Variant, exp: number) {
    return createHmac('sha256', `files:${this.secret}`).update(`${id}.${variant}.${exp}`).digest('hex');
  }

  /** Path relative to the API prefix, e.g. /files/<id>?v=thumb&exp=...&sig=... */
  path(id: string, variant: Variant, ttlSeconds = 3600, now = Date.now()): string {
    const exp = Math.floor(now / 1000) + ttlSeconds;
    return `/files/${id}?v=${variant}&exp=${exp}&sig=${this.mac(id, variant, exp)}`;
  }

  verify(id: string, variant: string, exp: string, sig: string, now = Date.now()): variant is Variant {
    if (variant !== 'full' && variant !== 'thumb') return false;
    const e = Number(exp);
    if (!Number.isInteger(e) || e < Math.floor(now / 1000)) return false;
    const expected = Buffer.from(this.mac(id, variant, e));
    const given = Buffer.from(String(sig ?? ''));
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
