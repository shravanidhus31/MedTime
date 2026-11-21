// Approval hand-off for tools with approvalLevel > 0 (A2.2).
//
// The real system is Person B's (contract C5: ProposedChange, propose_change,
// registerProposalKind). Until it exists, this stand-in records nothing in the database:
// it logs the proposal and returns a pending id. B plugs the real one in with:
//
//   setProposalHandler(async ({ tool, input, level, ctx }) => ({ proposalId, status: 'pending' }));

let handler = async function stubProposal({ tool, input, level, ctx }) {
  const proposalId = `stub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[proposals:stub] ${tool} (level ${level}) queued as ${proposalId} for run ${ctx && ctx.runId}`, input);
  return { proposalId, status: 'pending', stub: true };
};

function setProposalHandler(fn) {
  if (typeof fn !== 'function') throw new TypeError('setProposalHandler needs a function');
  handler = fn;
}

async function proposeChange(args) {
  return handler(args);
}

module.exports = { proposeChange, setProposalHandler };
