const request = require('supertest');
const app = require('../../index');

describe('GET /api/health', () => {
  it('should return 200 OK with status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});


