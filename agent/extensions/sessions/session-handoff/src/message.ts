const addSection = (title: string, body: string): string =>
  `## ${title}\n${body.trim()}`;

const buildQuerySessionGuidance = (
  sourceSessionId: string | undefined
): string => {
  if (!sourceSessionId) {
    return 'If you need more context from prior sessions, use the `query_session` tool with the session UUID for targeted questions.';
  }

  return [
    `This session was handed off from session \`${sourceSessionId}\`.`,
    `If you need more context, use \`query_session(session: "${sourceSessionId}", question: "...")\` for targeted questions.`,
  ].join('\n');
};

export const composeHandoffPrefill = (
  handoffMarkdown: string,
  optionalInstruction: string,
  sourceSessionId?: string
): string => {
  const sections = [handoffMarkdown.trim()];

  sections.push(
    addSection(
      'Additional Context Retrieval',
      buildQuerySessionGuidance(sourceSessionId)
    )
  );

  const trimmedOptionalInstruction = optionalInstruction.trim();
  if (trimmedOptionalInstruction) {
    sections.push(
      addSection('Additional Instruction', trimmedOptionalInstruction)
    );
  }

  return sections.join('\n\n');
};
