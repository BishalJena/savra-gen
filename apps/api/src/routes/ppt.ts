// PPT generation routes
// POST /api/ppt/generate — submit a generation request
// GET  /api/ppt/job/:jobId — poll job status
// GET  /api/ppt/download/:jobId — download generated PPTX
// GET  /api/ppt/stats — cache & cost metrics
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { pptQueue } from '../lib/queue';
import { generateCacheKey, getCacheStats } from '../lib/cache';
import type { PptRequest, PptJobData } from '../shared';
import path from 'path';
import fs from 'fs';

// Rate limiting: track requests per teacher (simplified — in production, use teacher auth token)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10; // requests per minute
const RATE_WINDOW = 60 * 1000; // 1 minute

function checkRateLimit(clientId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(clientId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(clientId, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// Request deduplication: prevent duplicate jobs for identical requests within 30s
const recentRequests = new Map<string, { jobId: string; timestamp: number }>();
const DEDUP_WINDOW = 30 * 1000; // 30 seconds

export async function pptRoutes(fastify: FastifyInstance) {
  // POST /api/ppt/generate
  fastify.post('/api/ppt/generate', {
    schema: {
      body: {
        type: 'object',
        required: ['topic', 'grade', 'subject', 'numSlides'],
        properties: {
          topic: { type: 'string', minLength: 2, maxLength: 200 },
          grade: { type: 'integer', minimum: 1, maximum: 12 },
          subject: { type: 'string', minLength: 2, maxLength: 100 },
          numSlides: { type: 'integer', minimum: 3, maximum: 25 },
          language: { type: 'string', default: 'en' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: PptRequest }>, reply: FastifyReply) => {
    const clientId = request.ip || 'unknown';

    // Rate limiting
    if (!checkRateLimit(clientId)) {
      return reply.status(429).send({
        error: 'Too many requests. Please wait a moment before generating another PPT.',
        retryAfterSeconds: 60,
      });
    }

    const { topic, grade, subject, numSlides, language } = request.body;
    const cacheKey = generateCacheKey({ topic, grade, subject, numSlides });

    // Request deduplication: if same request was submitted <30s ago, return existing jobId
    const dedupKey = cacheKey;
    const recent = recentRequests.get(dedupKey);
    if (recent && Date.now() - recent.timestamp < DEDUP_WINDOW) {
      fastify.log.info({ jobId: recent.jobId }, 'Deduplication hit — returning existing job');
      return reply.status(200).send({
        jobId: recent.jobId,
        status: 'queued',
        deduplicated: true,
        estimatedSeconds: 15,
        pollUrl: `/api/ppt/job/${recent.jobId}`,
      });
    }

    const jobId = randomUUID().substring(0, 8);

    const jobData: PptJobData = {
      topic,
      grade,
      subject,
      numSlides,
      language: language || 'en',
      cacheKey,
      requestedAt: new Date().toISOString(),
    };

    // Enqueue the job in BullMQ
    await pptQueue.add('generate-ppt', jobData, {
      jobId,
      priority: 1, // All jobs equal priority for now
    });

    // Track for deduplication
    recentRequests.set(dedupKey, { jobId, timestamp: Date.now() });

    fastify.log.info({ jobId, topic, grade, subject, numSlides }, 'PPT generation job queued');

    return reply.status(202).send({
      jobId,
      status: 'queued',
      estimatedSeconds: 15,
      pollUrl: `/api/ppt/job/${jobId}`,
    });
  });

  // GET /api/ppt/job/:jobId
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

  // GET /api/ppt/download/:jobId
  fastify.get('/api/ppt/download/:jobId', async (
    request: FastifyRequest<{ Params: { jobId: string } }>,
    reply: FastifyReply,
  ) => {
    const { jobId } = request.params;
    const outputDir = path.join(process.cwd(), '..', 'worker', 'output');
    const filePath = path.join(outputDir, `${jobId}.pptx`);

    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'File not found. It may have been cleaned up.' });
    }

    const job = await pptQueue.getJob(jobId);
    const topic = job?.data?.topic || 'presentation';
    const filename = `${topic.replace(/[^a-zA-Z0-9]/g, '_')}_Grade${job?.data?.grade || ''}.pptx`;

    return reply.header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      .send(fs.createReadStream(filePath));
  });

  // GET /api/ppt/stats — cache and cost metrics
  fastify.get('/api/ppt/stats', async (_request, reply) => {
    const stats = getCacheStats();
    const queueCounts = await pptQueue.getJobCounts();
    return reply.send({
      cache: stats,
      queue: queueCounts,
    });
  });
}
