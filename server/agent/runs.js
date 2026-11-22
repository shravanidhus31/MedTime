// Saving agent runs (A2.3). Wraps runLoop() so every run and every step lands in AgentRun.
//
//   const result = await runRecorded(
//     { trigger: 'dose_due', patientId, reminderId, flow: 'dose' },
//     { system, promptVersion, messages, tools: [...], ctx: { patientId } },
//   );
//   result.runId → the AgentRun id
//
// Saving must never break a call: if the database write fails, the run still goes ahead and
// the failure is logged.

const AgentRun = require('../models/AgentRun');
const { runLoop } = require('./loop');

async function startRun({ trigger, patientId, reminderId, flow, promptVersion }) {
  const run = await AgentRun.create({
    trigger,
    patient: patientId,
    reminder: reminderId,
    flow,
    promptVersion,
    status: 'running',
    startedAt: new Date(),
  });
  return run._id;
}

async function addStep(runId, step) {
  await AgentRun.updateOne(
    { _id: runId },
    {
      $push: {
        steps: {
          tool: step.tool,
          input: step.input,
          output: step.output,
          ms: step.ms,
          at: step.at,
          approvalLevel: step.approvalLevel,
          proposalId: step.proposalId,
          // the plain-language line the Activity panel and journal show (were dropped here before
          // 22 Nov, so every step saved through addStep lost its summary)
          label: step.label,
          summaryText: step.summaryText,
        },
      },
      $inc: { stepCount: 1 },
    },
  );
}

async function finishRun(runId, result) {
  await AgentRun.updateOne(
    { _id: runId },
    {
      $set: {
        status: 'finished',
        outcome: result.outcome,
        fallbackReason: result.fallbackReason,
        error: result.error,
        text: result.text,
        model: result.model,
        promptVersion: result.promptVersion,
        llmCalls: result.llmCalls,
        usage: result.usage,
        endedAt: new Date(),
        ms: result.ms,
      },
    },
  );
}

async function failRun(runId, err) {
  await AgentRun.updateOne(
    { _id: runId },
    {
      $set: {
        status: 'failed',
        outcome: 'fallback',
        fallbackReason: 'crash',
        error: { kind: 'crash', message: err && err.message },
        endedAt: new Date(),
      },
    },
  );
}

const logSaveError = (what) => (err) => console.error(`[agent:runs] could not ${what}:`, err.message);

async function runRecorded(run, loopArgs) {
  let runId = null;
  try {
    runId = await startRun({ ...run, promptVersion: loopArgs.promptVersion });
  } catch (err) {
    logSaveError('start the run record')(err);
  }

  const ctx = { ...(loopArgs.ctx || {}), runId: runId ? String(runId) : undefined, flow: run.flow };
  const callerOnStep = loopArgs.onStep;
  const onStep = async (step) => {
    if (runId) await addStep(runId, step).catch(logSaveError('save a step'));
    if (callerOnStep) await callerOnStep(step);
  };

  try {
    const result = await runLoop({ ...loopArgs, ctx, onStep });
    if (runId) await finishRun(runId, result).catch(logSaveError('finish the run record'));
    return { ...result, runId: runId ? String(runId) : null };
  } catch (err) {
    if (runId) await failRun(runId, err).catch(logSaveError('mark the run failed'));
    throw err;
  }
}

module.exports = { runRecorded, startRun, addStep, finishRun, failRun };
