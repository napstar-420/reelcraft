import type { Modality, OutputDef } from '@reelcraft/shared';

/** `params.count`: how many images an image request asks for (1 when unset). */
export function requestedImageCount(params: Record<string, unknown> | undefined): number {
  const count = params?.count;
  return typeof count === 'number' && Number.isInteger(count) && count > 1 ? count : 1;
}

export function buildJobPrompt(input: {
  modality: Modality;
  params?: Record<string, unknown>;
  system?: string | undefined;
  renderedPrompt?: string | undefined;
  output?: OutputDef | undefined;
}): string {
  const imageCount = requestedImageCount(input.params);
  const modalityInstruction =
    input.modality === 'image'
      ? imageCount > 1
        ? `Use the installed image-generation extension. Make ${imageCount} different final images from the prompt, one at a time, and write each under outputs/. Return the supplied result manifest with an "images" list of ${imageCount} entries, in order, each with its relative path, MIME type, and filename.`
        : 'Use the installed image-generation extension. Write exactly one final image under outputs/ and return the supplied result manifest with its relative path, MIME type, and filename.'
      : input.modality === 'browser'
        ? 'Use BrowserOS Neo exclusively. Call its name_session operation first with the supplied session name, work only in tabs created for this task, close or detach only those tabs when finished, and return the supplied manifest containing the structured result plus any screenshot or download evidence written under outputs/. Do not fall back to another browser tool.'
        : input.modality === 'code'
          ? 'Work only in your current folder. Read what you are given under inputs/, write the files you make under outputs/, and run only the commands named in the instructions. Then return the supplied manifest: the structured result as "output", every file under outputs/ that is part of your answer as an attachment with role "download", and any picture you made to check your work as an attachment with role "evidence".'
          : undefined;
  const browserContext =
    input.modality === 'browser'
      ? [
          `Session name: ${String(input.params?.__sessionName ?? 'reelcraft-browser')}`,
          `Maximum browser steps: ${String(input.params?.__browserMaxSteps ?? 500)}`,
          ...(typeof input.params?.startUrl === 'string'
            ? [`Start URL: ${input.params.startUrl}`]
            : []),
          ...(Array.isArray(input.params?.__referenceFiles) && input.params.__referenceFiles.length
            ? [`Input files provided to you: ${input.params.__referenceFiles.join(', ')}`]
            : []),
          ...(typeof input.params?.__progressDir === 'string'
            ? [
                `Persistent progress directory: ${input.params.__progressDir} (kept across attempts; save finished work there)`,
              ]
            : []),
        ].join('\n')
      : undefined;
  const codeContext =
    input.modality === 'code' && Array.isArray(input.params?.__referenceFiles)
      ? input.params.__referenceFiles.length
        ? `Input files: ${input.params.__referenceFiles.join(', ')}`
        : 'There are no input files.'
      : undefined;
  const imageContext =
    input.modality === 'image' && Array.isArray(input.params?.__referenceFiles)
      ? `Reference images available to the image tool: ${input.params.__referenceFiles.join(', ')}`
      : undefined;
  // A judge reading files (such as video clips) opens them with local tools.
  const inspectContext =
    input.modality === 'text' && Array.isArray(input.params?.__referenceFiles)
      ? `Files to inspect, in order: ${input.params.__referenceFiles.join(', ')}. Open and examine them yourself with the local tools you have (for example ffmpeg to extract frames and audio); do not guess from the file names.`
      : undefined;
  const outputInstruction =
    input.output?.kind === 'data'
      ? 'Return only JSON matching the supplied output schema. Do not wrap it in Markdown.'
      : input.output?.kind === 'timeline'
        ? 'Return only a Reelcraft timeline JSON value matching the supplied output schema. Do not wrap it in Markdown.'
        : 'Return the final text response verbatim.';
  return [
    '<system_instructions>',
    input.system ?? 'Follow the user request.',
    '</system_instructions>',
    '<user_prompt>',
    input.renderedPrompt ?? '',
    '</user_prompt>',
    '<output_requirements>',
    ...(modalityInstruction ? [modalityInstruction] : []),
    ...(browserContext ? [browserContext] : []),
    ...(imageContext ? [imageContext] : []),
    ...(codeContext ? [codeContext] : []),
    ...(inspectContext ? [inspectContext] : []),
    outputInstruction,
    '</output_requirements>',
  ].join('\n');
}
