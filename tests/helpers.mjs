import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../dist/config.js';
import { BrightspaceClient } from '../dist/client.js';
import { SchoolService } from '../dist/service.js';

export async function config(overrides = {}) {
  return buildConfig({ dataDir: await mkdtemp(join(tmpdir(), 'brightspace-mcp-test-')),
    baseUrl: 'https://school.example.edu', lpVersion: '1.49', leVersion: '1.94',
    requestSpacingMs: 0, retries: 0, ...overrides }, {});
}
export function response(value, status = 200, headers = {}) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json', ...headers }
  });
}
export function mockClient(cfg, handler) {
  const calls = [];
  const client = new BrightspaceClient(cfg, { getHeaders: async () => ({ Authorization: 'Bearer TEST_SECRET_DO_NOT_LOG' }),
    fetchImpl: async (url, options) => { calls.push({ url: String(url), options }); return handler(new URL(url), options, calls.length); },
    sleepImpl: async () => {} });
  return { client, service: new SchoolService(client), calls };
}
export function schoolFixture(cfg, overrides = {}) {
  return mockClient(cfg, (url) => {
    if (overrides[url.pathname]) return overrides[url.pathname](url);
    const p = url.pathname;
    if (p.endsWith('/users/whoami')) return response({ Identifier: '42', FirstName: 'Demo', LastName: 'Student' });
    if (p.endsWith('/enrollments/myenrollments/')) return response({ Items: [{ OrgUnit: { Id: 100, Name: 'Demo mathematics', Code: 'DEMO', IsActive: true }, Access: { CanAccess: true } }], PagingInfo: { HasMoreItems: false } });
    if (p.endsWith('/dropbox/folders/')) return response([{ Id: 11, Name: 'Demo portfolio', DueDate: '2026-11-20T22:59:00Z',
      Availability: { EndDate: '2026-11-22T22:59:00Z' }, CustomInstructions: { Html: '<p>Explain your reasoning.</p>' }, Assessment: { Rubrics: [] } }]);
    if (p.endsWith('/news/')) return response([{ Id: 21, Title: 'Demo announcement', IsPublished: true, Body: { Text: 'Bring your notebook.' }, CreatedDate: '2026-11-01T09:00:00Z' }]);
    if (p.endsWith('/quizzes/')) return response({ Objects: [{ QuizId: 31, Name: 'Demo quiz', DueDate: null, EndDate: '2026-11-23T09:00:00Z' }], Next: null });
    if (p.endsWith('/content/toc')) return response({ Modules: [{ ModuleId: 51, Title: 'Week 1', Topics: [{ TopicId: 52, Title: 'Demo study guide', TopicType: 1, DueDate: '2026-11-25' }], Modules: [] }] });
    if (p.endsWith('/calendar/events/myEvents/')) return response({ Objects: [{ CalendarEventId: 61, Title: 'Demo lesson', StartDateTime: '2026-11-24T08:30:00Z', IsAllDayEvent: false }], Next: null });
    if (p.endsWith('/grades/values/myGradeValues/')) return response([{ GradeObjectIdentifier: '71', GradeObjectName: 'Demo score', PointsNumerator: null, PointsDenominator: 20 }]);
    if (p.endsWith('/content/topics/52')) return response({ Id: 52, Title: 'Demo study guide', TopicType: 1, Url: '/content/demo.html' });
    if (p.endsWith('/content/topics/52/file')) return response('<h1>Study guide</h1><p>Practice equations.</p>', 200, { 'content-type': 'text/html' });
    throw new Error(`Unexpected fixture route: ${p}`);
  });
}
