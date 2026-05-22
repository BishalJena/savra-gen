// PPT generation routes
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { pptQueue } from '../lib/queue';
import { generateCacheKey, getCacheStats, resolvePresentation } from '../lib/cache';
import { listChapters, recordChapter } from '../lib/chapters';
import { buildDraftOutline, generateApprovedCacheKey, validatePresentation } from '../lib/outline';
import { populateSlide } from '../lib/populate-slide';
import type { GenerateFromOutlineRequest, PptRequest, PptJobData } from '../shared';
import { parsePptRequest } from '../shared';
import { createStorage } from '../lib/storage';
import { checkRateLimit, releaseDedupReservation, reserveOrGetDuplicateJob } from '../lib/request-guards';
import path from 'path';
import fs from 'fs';

const storage = createStorage({ localDir: path.join(process.cwd(), '..', 'worker', 'output') });

const pptBodySchema = {
  type: 'object',
  required: ['grade', 'subject', 'numSlides'],
  properties: {
    chapter: { type: 'string', minLength: 2, maxLength: 200 },
    topic: { type: 'string', minLength: 2, maxLength: 200 },
    grade: { type: 'integer', minimum: 1, maximum: 12 },
    subject: { type: 'string', minLength: 2, maxLength: 100 },
    numSlides: { type: 'integer', minimum: 3, maximum: 25 },
    language: { type: 'string', default: 'en' },
    presentation: { type: 'object' },
  },
};

export async function pptRoutes(fastify: FastifyInstance) {
  fastify.get('/api/ppt/chapters', async (
    request: FastifyRequest<{ Querystring: { grade?: string; subject?: string } }>,
    reply: FastifyReply,
  ) => {
    const grade = Number(request.query.grade);
    const subject = request.query.subject?.trim();
    if (!grade || grade < 1 || grade > 12 || !subject) {
      return reply.status(400).send({ error: 'grade and subject query params are required' });
    }
    const chapters = await listChapters(grade, subject);
    return reply.send({ grade, subject, chapters });
  });

  fastify.post('/api/ppt/outline', {
    schema: { body: pptBodySchema },
  }, async (request: FastifyRequest<{ Body: Record<string, unknown> }>, reply: FastifyReply) => {
    const clientId = request.ip || 'unknown';
    const rateLimit = await checkRateLimit(clientId);
    if (!rateLimit.allowed) {
      return reply.status(429).send({
        error: 'Too many requests. Please wait a moment before drafting another outline.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }

    const body = parsePptRequest(request.body);
    if (!body.chapter) {
      return reply.status(400).send({ error: 'chapter is required (topic is accepted as an alias)' });
    }

    await recordChapter(body.grade, body.subject, body.chapter);

    const resolved = await resolvePresentation(body);

    return reply.status(200).send({
      presentation: resolved.presentation,
      cached: resolved.cached,
      strategy: resolved.strategy,
      similarityScore: resolved.similarityScore,
      matchedChapter: resolved.matchedChapter,
      estimatedSecondsSaved: resolved.cached ? 20 : 0,
    });
  });

  fastify.post('/api/ppt/slide/populate', async (
    request: FastifyRequest<{ Body: Record<string, unknown> }>,
    reply: FastifyReply,
  ) => {
    const clientId = request.ip || 'unknown';
    const rateLimit = await checkRateLimit(clientId);
    if (!rateLimit.allowed) {
      return reply.status(429).send({
        error: 'Too many requests. Please wait before populating another slide.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }

    const parsed = parsePptRequest(request.body);
    if (!parsed.chapter) {
      return reply.status(400).send({ error: 'chapter is required' });
    }

    const presentation = request.body.presentation;
    const slideIndex = Number(request.body.slideIndex);
    const slideType = String(request.body.slideType || 'bullet-list');
    const intent = String(request.body.intent || '').trim();
    const activityRole = request.body.activityRole
      ? String(request.body.activityRole)
      : undefined;

    if (!presentation || typeof presentation !== 'object' || !Array.isArray((presentation as any).slides)) {
      return reply.status(400).send({ error: 'presentation with slides array is required' });
    }
    if (!Number.isInteger(slideIndex) || slideIndex < 0) {
      return reply.status(400).send({ error: 'slideIndex must be a non-negative integer' });
    }

    const validTypes = ['title', 'bullet-list', 'two-column', 'content-with-image', 'quote-or-definition', 'quiz'];
    if (!validTypes.includes(slideType)) {
      return reply.status(400).send({ error: `slideType must be one of: ${validTypes.join(', ')}` });
    }

    try {
      const validRoles = ['quiz', 'discussion', 'definition', 'visual', 'general'];
      const role = activityRole && validRoles.includes(activityRole) ? activityRole : undefined;

      const result = await populateSlide({
        ...parsed,
        slideIndex,
        slideType: slideType as any,
        intent,
        activityRole: role as any,
        presentation: presentation as GenerateFromOutlineRequest['presentation'],
      });
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Populate failed' });
    }
  });

  fastify.post('/api/ppt/generate', {
    schema: { body: pptBodySchema },
  }, async (request: FastifyRequest<{ Body: Record<string, unknown> }>, reply: FastifyReply) => {
    const clientId = request.ip || 'unknown';
    const rateLimit = await checkRateLimit(clientId);
    if (!rateLimit.allowed) {
      return reply.status(429).send({
        error: 'Too many requests. Please wait a moment before generating another PPT.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }

    const parsed = parsePptRequest(request.body);
    if (!parsed.chapter) {
      return reply.status(400).send({ error: 'chapter is required (topic is accepted as an alias)' });
    }

    const approvedPresentation =
      request.body.presentation && typeof request.body.presentation === 'object'
        ? (request.body.presentation as GenerateFromOutlineRequest['presentation'])
        : undefined;

    if (approvedPresentation) {
      const validationError = validatePresentation(approvedPresentation);
      if (validationError) {
        return reply.status(400).send({ error: validationError });
      }
    }

    await recordChapter(parsed.grade, parsed.subject, parsed.chapter);

    const cacheKey = approvedPresentation
      ? generateApprovedCacheKey({ ...parsed, presentation: approvedPresentation })
      : generateCacheKey(parsed);

    const dedupKey = cacheKey;
    const jobId = randomUUID().substring(0, 8);
    const dedupe = await reserveOrGetDuplicateJob(dedupKey, jobId);
    if (!dedupe.reserved && dedupe.jobId) {
      fastify.log.info({ jobId: dedupe.jobId }, 'Deduplication hit — returning existing job');
      return reply.status(200).send({
        jobId: dedupe.jobId,
        status: 'queued',
        deduplicated: true,
        estimatedSeconds: 15,
        pollUrl: `/api/ppt/job/${dedupe.jobId}`,
      });
    }

    const jobData: PptJobData = {
      chapter: parsed.chapter,
      grade: parsed.grade,
      subject: parsed.subject,
      numSlides: parsed.numSlides,
      language: parsed.language || 'en',
      cacheKey,
      requestedAt: new Date().toISOString(),
      approvedPresentation,
    };

    try {
      await pptQueue.add('generate-ppt', jobData, { jobId, priority: 1 });
    } catch (err) {
      await releaseDedupReservation(dedupKey, jobId);
      throw err;
    }

    fastify.log.info(
      { jobId, chapter: parsed.chapter, grade: parsed.grade, subject: parsed.subject, numSlides: parsed.numSlides },
      'PPT generation job queued',
    );

    return reply.status(202).send({
      jobId,
      status: 'queued',
      estimatedSeconds: 15,
      pollUrl: `/api/ppt/job/${jobId}`,
    });
  });

  fastify.get('/api/ppt/job/:jobId', async (
    request: FastifyRequest<{ Params: { jobId: string } }>,
    reply: FastifyReply,
  ) => {
    const { jobId } = request.params;
    const job = await pptQueue.getJob(jobId);

    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    const state = await job.getState();
    const progress = (job.progress as any) || {};

    const response: any = {
      jobId,
      status: state === 'completed' ? 'done' : state === 'active' ? 'processing' : state,
      cached: progress.cached || false,
      createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : '',
    };

    if (state === 'completed') {
      response.status = 'done';
      response.downloadUrl = `/api/ppt/download/${jobId}`;
      response.tokensUsed = job.returnvalue?.tokensUsed || 0;
      response.costINR = job.returnvalue?.costINR || 0;
      response.model = job.returnvalue?.model || 'unknown';
      response.slidePreview = job.returnvalue?.slidePreview || null;
    } else if (state === 'active') {
      response.step = progress.step || 'Processing...';
      response.progress = progress.percent || 0;
    } else if (state === 'failed') {
      response.error = job.failedReason || 'Generation failed after all retries';
    }

    return reply.send(response);
  });

  fastify.get('/api/ppt/download/:jobId', async (
    request: FastifyRequest<{ Params: { jobId: string } }>,
    reply: FastifyReply,
  ) => {
    const { jobId } = request.params;
    const job = await pptQueue.getJob(jobId);
    const stored = job?.returnvalue?.storage;
    if (stored?.driver === 'r2' && stored.objectKey) {
      const signedUrl = await storage.downloadUrl(stored.objectKey, 300);
      if (!signedUrl) return reply.status(404).send({ error: 'File not found. It may have been cleaned up.' });
      return reply.redirect(signedUrl);
    }

    const outputDir = path.join(process.cwd(), '..', 'worker', 'output');
    const filePath = path.join(outputDir, `${jobId}.pptx`);

    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'File not found. It may have been cleaned up.' });
    }

    const chapter = job?.data?.chapter || 'presentation';
    const filename = `${chapter.replace(/[^a-zA-Z0-9]/g, '_')}_Class${job?.data?.grade || ''}.pptx`;

    return reply.header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      .send(fs.createReadStream(filePath));
  });

  fastify.get('/api/ppt/stats', async (_request, reply) => {
    const stats = await getCacheStats();
    const queueCounts = await pptQueue.getJobCounts();
    return reply.send({ cache: stats, queue: queueCounts });
  });
}
