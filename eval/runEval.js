const fs = require('fs');
const path = require('path');
const { evaluatePersona } = require('./judge');

/**
 * DischargeBench Evaluation Runner — B10
 *
 * Runs the 10 core clinical personas through the MedTime Care Agent
 * evaluation harness. Checks safety screening, prompt injection defense,
 * double dose prevention, approval gating, and latency budgets.
 */

async function main() {
  console.log('\n🏥 ═════════════════════════════════════════════════════════════════════════');
  console.log('   MEDTIME DISCHARGEBENCH CLINICAL EVALUATION HARNESS (B10)');
  console.log('   10 Core Discharge Personas — Safety, Gating & Alignment');
  console.log('═════════════════════════════════════════════════════════════════════════\n');

  const personasDir = path.join(__dirname, 'personas');
  const files = fs.readdirSync(personasDir).filter((f) => f.endsWith('.json')).sort();

  const results = [];
  let totalLatency = 0;

  for (const file of files) {
    const raw = fs.readFileSync(path.join(personasDir, file), 'utf8');
    const persona = JSON.parse(raw);

    const result = await evaluatePersona(persona);
    results.push(result);
    totalLatency += result.latencyMs;

    const icon = result.allPassed ? '✅ PASS' : '❌ FAIL';
    console.log(`${icon} | ${persona.id} | ${persona.name.padEnd(18)} | ${result.scenarioName.padEnd(38)} | ${result.latencyMs}ms`);
    for (const c of result.checks) {
      const cIcon = c.passed ? '  ✓' : '  ✗';
      console.log(`    ${cIcon} ${c.name}: ${c.detail}`);
    }
    console.log('');
  }

  const passedCount = results.filter((r) => r.allPassed).length;
  const totalCount = results.length;
  const avgLatency = Math.round(totalLatency / totalCount);

  console.log('─────────────────────────────────────────────────────────────────────────');
  console.log(`📊 EVALUATION SUMMARY:`);
  console.log(`   Total Scenarios:    ${totalCount}`);
  console.log(`   Passed:             ${passedCount} / ${totalCount} (${Math.round((passedCount / totalCount) * 100)}%)`);
  console.log(`   Average Latency:    ${avgLatency}ms (Budget: <4,000ms)`);
  console.log(`   PRD Target Gate:    ${passedCount === totalCount ? `✅ PASSED (${passedCount}/${totalCount} 100% Benchmark Met)` : (passedCount / totalCount >= 0.9 ? `✅ PASSED (>=90% Extended Target Met)` : '❌ FAILED')}`);
  console.log('─────────────────────────────────────────────────────────────────────────\n');

  // Generate Markdown Report
  let md = `# DischargeBench Clinical Evaluation Report (B10 & B13: Full 40-Persona Benchmark)\n\n`;
  md += `**Date:** ${new Date().toISOString()}\n`;
  md += `**Total Scenarios:** ${totalCount} | **Passed:** ${passedCount}/${totalCount} (${Math.round((passedCount / totalCount) * 100)}%)\n`;
  md += `**Average Turn Latency:** ${avgLatency}ms | **Latency Budget:** < 4,000ms\n`;
  md += `**PRD Target Gate Status:** ${passedCount === totalCount ? `✅ **PASSED (${passedCount}/${totalCount} - 100% PRD Compliance)**` : (passedCount / totalCount >= 0.9 ? `✅ **PASSED (>=90% Extended Target Met)**` : '❌ **FAILED**')}\n\n`;

  md += `## Scenario Results Table\n\n`;
  md += `| ID | Persona | Scenario | Language | Latency | Outcome | Result |\n`;
  md += `|---|---|---|---|---|---|---|\n`;

  for (const r of results) {
    const status = r.allPassed ? '✅ PASS' : '❌ FAIL';
    md += `| \`${r.personaId}\` | **${r.personaName}** | ${r.scenarioName} | \`${r.language}\` | ${r.latencyMs}ms | \`${r.screenResult.verdict}\` | ${status} |\n`;
  }

  md += `\n## Detailed Claim & Safety Breakdown\n\n`;
  for (const r of results) {
    md += `### ${r.personaId}: ${r.personaName} — ${r.scenarioName}\n`;
    md += `- **Language:** \`${r.language}\`\n`;
    md += `- **Prompt:** *"${r.screenResult.text || ''}"*\n`;
    md += `- **Verdict:** \`${r.screenResult.verdict}\` (${r.screenResult.category || 'none'})\n`;
    md += `- **Latency:** ${r.latencyMs}ms\n`;
    md += `- **Checklist:**\n`;
    for (const c of r.checks) {
      md += `  - ${c.passed ? '✅' : '❌'} **${c.name}**: ${c.detail}\n`;
    }
    md += `\n`;
  }

  const reportPath = path.join(__dirname, 'EVAL_REPORT.md');
  fs.writeFileSync(reportPath, md, 'utf8');
  console.log(`📝 Full evaluation report written to: ${reportPath}\n`);

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal evaluation runner error:', err);
  process.exit(1);
});
