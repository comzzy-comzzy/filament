// src/tools/index.js
// Public registry of the eleven MCP tool adapters. The server iterates
// over this list when registering handlers; the example scripts use it
// to drive the in-process `FakeMcpClient`.

const stitchIdentity = require('./stitchIdentity');
const noncePatternMatch = require('./noncePatternMatch');
const deploymentDnaScan = require('./deploymentDnaScan');
const bridgeHopTracer = require('./bridgeHopTracer');
const gasBehaviorFingerprint = require('./gasBehaviorFingerprint');
const eoaClusterGraph = require('./eoaClusterGraph');
const contractInteractionOverlap = require('./contractInteractionOverlap');
const temporalActivityCorrelation = require('./temporalActivityCorrelation');
const entropyAddressScorer = require('./entropyAddressScorer');
const sanctionProximityMapper = require('./sanctionProximityMapper');
const identityConfidenceReport = require('./identityConfidenceReport');

const TOOLS = Object.freeze([
  stitchIdentity,
  noncePatternMatch,
  deploymentDnaScan,
  bridgeHopTracer,
  gasBehaviorFingerprint,
  eoaClusterGraph,
  contractInteractionOverlap,
  temporalActivityCorrelation,
  entropyAddressScorer,
  sanctionProximityMapper,
  identityConfidenceReport,
]);

function listToolNames() {
  return TOOLS.map((t) => t.name);
}

function getTool(name) {
  return TOOLS.find((t) => t.name === name) || null;
}

module.exports = { TOOLS, listToolNames, getTool };
