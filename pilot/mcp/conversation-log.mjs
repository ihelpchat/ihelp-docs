// Implemented after the RED tests in M5.51.
export async function saveConversation() { return null; }
export async function listConversations() { return []; }
export function summarizeConversations() { return { total: 0, percentages: {}, byTopic: [], byCompany: [], unresolved: [] }; }
export async function pruneConversations() { return 0; }
