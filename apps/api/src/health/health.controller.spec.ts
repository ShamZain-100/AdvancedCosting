import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports database up when the query succeeds', async () => {
    const c = new HealthController({ $queryRaw: jest.fn().mockResolvedValue([1]) } as any);
    expect((await c.check()).database).toBe('up');
  });
  it('answers 503 with the details when the query fails, so monitors and Docker see the outage', async () => {
    const c = new HealthController({ $queryRaw: jest.fn().mockRejectedValue(new Error('x')) } as any);
    await expect(c.check()).rejects.toMatchObject({ status: 503, response: expect.objectContaining({ database: 'down' }) });
  });
});
