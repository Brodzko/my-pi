const QUERY_SESSION_GUIDANCE =
  'If you need more context from prior sessions, use the `query_session` tool for targeted questions.';

const addSection = (title: string, body: string): string =>
  `## ${title}\n${body.trim()}`;

export const composeHandoffPrefill = (
  handoffMarkdown: string,
  optionalInstruction: string
): string => {
  const sections = [handoffMarkdown.trim()];

  sections.push(
    addSection('Additional Context Retrieval', QUERY_SESSION_GUIDANCE)
  );

  const trimmedOptionalInstruction = optionalInstruction.trim();
  if (trimmedOptionalInstruction) {
    sections.push(
      addSection('Additional Instruction', trimmedOptionalInstruction)
    );
  }

  return sections.join('\n\n');
};
