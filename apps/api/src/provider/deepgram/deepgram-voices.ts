import type { VoiceInfo } from '@reelcraft/shared';

/**
 * Deepgram's voice catalogs, copied from developers.deepgram.com/docs/tts-models
 * and /docs/flux-tts/voices. Deepgram has no endpoint that lists voices, so a
 * new voice means a new line here. One voice per line:
 * `name | gender | age | accent | characteristics | use cases`.
 */

const FLUX_EN = `
hannah|female|Young|American|Clear, confident, thoughtful, pleasant, nice|Casual chat, storytelling
kit|male|Young Adult|British|Friendly, energetic, thoughtful, calm, helpful|Customer service, narration, financial services
alexis|female|Adult|American|Clear, professional, calm, caring, empathetic|Customer service, IVR, financial services
cliff|male|Mature|American|Deep, confident, calm, raspy, clear|Financial services, narration, customer service
sienna|female|Young Adult|American|Clear, professional, calm, warm, caring|Customer service, financial services, narration
cole|male|Young|American|Friendly, clear, interesting, energetic, engaging|Customer service, IVR
brooke|female|Young|American|Friendly, intelligent, fast, confident, energetic|Healthcare, financial services, casual chat
colin|male|Adult|British|Warm, friendly, trustworthy, confident, authoritative|Customer service, financial services, narration
gemma|female|Young|British|Friendly, kind, approachable, caring, happy|Customer service, IVR
haley|female|Young Adult|American|Clear, professional, caring, calm, empathetic|Customer service, financial services, IVR
heather|female|Young|American|Clear, engaging, energetic, friendly, thoughtful|Customer service, IVR
miles|male|Adult|American|Clear, calm, professional, confident, sincere|Customer service, financial services, informative
sean|male|Mature|British|Friendly, kind, caring, calming|IVR
bree|female|Mature|American|Friendly, sweet, kind|Customer service, casual chat
brittany|female|Mature|American|Confident, kind, soft|Casual chat
bruce|male|Adult|American|Friendly, kind, natural, believable, engaged|Customer service, IVR
conor|male|Mature|British|Confident, deep, friendly, relaxed|Customer service, IVR
donovan|male|Adult|American|Professional, calm, thoughtful|IVR
drew|male|Adult|American|Confident, relaxed, soft, young, calm|Healthcare, financial services, customer service, IVR
elise|female|Adult|American|Clear, professional, calm, caring, empathetic|Customer service, financial services, IVR
jack|male|Adult|British|Confident, thoughtful, friendly, professional, clear|Customer service, storytelling
kai|male|Young Adult|Singaporean|Clear, calm, professional, knowledgeable, caring|Customer service, informative, IVR
kelsey|female|Young Adult|American|Clear, professional, caring, calm, empathetic|Customer service, IVR, financial services
maeve|female|Adult|Irish|Friendly, energetic, confident, gentle, calm|Customer service, IVR, narration
marcelo|male|Young Adult|Filipino|Clear, calm, professional, knowledgeable, caring|Customer service, informative, IVR
marcus|male|Adult|American|Friendly, helpful, smooth, professional, kind|Customer service, casual chat
meena|female|Adult|Indian|Empathetic, professional, calm, reassuring, satisfying|Customer service, casual chat
meghan|female|Adult|American|Friendly, nice, energetic, kind, confident|Healthcare, financial services
naveen|male|Adult|Indian|Clear, professional, knowledgeable, calm, caring|Customer service, IVR, informative
paige|female|Young Adult|American|Clear, professional, calm, comfortable, caring|Customer service, financial services, IVR
priya|female|Adult|Indian|Confident, empathetic, professional, calm, reassuring|IVR
rufus|male|Adult|British|Friendly, confident, intelligent, gentle, enthusiastic|Healthcare, financial services, storytelling
sharon|female|Young|Australian|Formal, calm, relaxed, confident|Healthcare, financial services
tanner|male|Adult|British|Professional, calm, confident|Customer service
wade|male|Adult|American|Warm, confident, clear, enthusiastic, friendly|Customer service, casual chat
wes|male|Adult|American|Thoughtful, friendly, warm, interesting|Customer service, casual chat
`;

const AURA_2_EN = `
thalia|feminine|Adult|American|Clear, Confident, Energetic, Enthusiastic|Casual chat, customer service, IVR
andromeda|feminine|Adult|American|Casual, Expressive, Comfortable|Customer service, IVR
helena|feminine|Adult|American|Caring, Natural, Positive, Friendly, Raspy|IVR, casual chat
apollo|masculine|Adult|American|Confident, Comfortable, Casual|Casual chat
arcas|masculine|Adult|American|Natural, Smooth, Clear, Comfortable|Customer service, casual chat
aries|masculine|Adult|American|Warm, Energetic, Caring|Casual chat
amalthea|feminine|Young Adult|Filipino|Engaging, Natural, Cheerful|Casual chat
asteria|feminine|Adult|American|Clear, Confident, Knowledgeable, Energetic|Advertising
athena|feminine|Mature|American|Calm, Smooth, Professional|Storytelling
atlas|masculine|Mature|American|Enthusiastic, Confident, Approachable, Friendly|Advertising
aurora|feminine|Adult|American|Cheerful, Expressive, Energetic|Interview
callista|feminine|Adult|American|Clear, Energetic, Professional, Smooth|IVR
cora|feminine|Adult|American|Smooth, Melodic, Caring|Storytelling
cordelia|feminine|Young Adult|American|Approachable, Warm, Polite|Storytelling
delia|feminine|Young Adult|American|Casual, Friendly, Cheerful, Breathy|Interview
draco|masculine|Adult|British|Warm, Approachable, Trustworthy, Baritone|Storytelling
electra|feminine|Adult|American|Professional, Engaging, Knowledgeable|IVR, advertising, customer service
harmonia|feminine|Adult|American|Empathetic, Clear, Calm, Confident|Customer service
hera|feminine|Adult|American|Smooth, Warm, Professional|Informative
hermes|masculine|Adult|American|Expressive, Engaging, Professional|Informative
hyperion|masculine|Adult|Australian|Caring, Warm, Empathetic|Interview
iris|feminine|Young Adult|American|Cheerful, Positive, Approachable|IVR, advertising, customer service
janus|feminine|Adult|American|Southern, Smooth, Trustworthy|Storytelling
juno|feminine|Adult|American|Natural, Engaging, Melodic, Breathy|Interview
jupiter|masculine|Adult|American|Expressive, Knowledgeable, Baritone|Informative
luna|feminine|Young Adult|American|Friendly, Natural, Engaging|IVR
mars|masculine|Adult|American|Smooth, Patient, Trustworthy, Baritone|Customer service
minerva|feminine|Adult|American|Positive, Friendly, Natural|Storytelling
neptune|masculine|Adult|American|Professional, Patient, Polite|Customer service
odysseus|masculine|Adult|American|Calm, Smooth, Comfortable, Professional|Advertising
ophelia|feminine|Adult|American|Expressive, Enthusiastic, Cheerful|Interview
orion|masculine|Adult|American|Approachable, Comfortable, Calm, Polite|Informative
orpheus|masculine|Adult|American|Professional, Clear, Confident, Trustworthy|Customer service, storytelling
pandora|feminine|Adult|British|Smooth, Calm, Melodic, Breathy|IVR, informative
phoebe|feminine|Adult|American|Energetic, Warm, Casual|Customer service
pluto|masculine|Adult|American|Smooth, Calm, Empathetic, Baritone|Interview, storytelling
saturn|masculine|Adult|American|Knowledgeable, Confident, Baritone|Customer service
selene|feminine|Adult|American|Expressive, Engaging, Energetic|Informative
theia|feminine|Adult|Australian|Expressive, Polite, Sincere|Informative
vesta|feminine|Adult|American|Natural, Expressive, Patient, Empathetic|Customer service, interview, storytelling
zeus|masculine|Adult|American|Deep, Trustworthy, Smooth|IVR
`;

const AURA_2_ES = `
celeste|feminine|Young Adult|Colombian|Clear, Energetic, Positive, Friendly, Enthusiastic|Casual Chat, Advertising, IVR
estrella|feminine|Mature|Mexican|Approachable, Natural, Calm, Comfortable, Expressive|Casual Chat, Interview
nestor|masculine|Adult|Peninsular|Calm, Professional, Approachable, Clear, Confident|Casual Chat, Customer Service
sirio|masculine|Adult|Mexican|Calm, Professional, Comfortable, Empathetic, Baritone|Casual Chat, Interview
carina|feminine|Adult|Peninsular|Professional, Raspy, Energetic, Breathy, Confident|Interview, Customer Service, IVR
alvaro|masculine|Adult|Peninsular|Calm, Professional, Clear, Knowledgeable, Approachable|Interview, Customer Service
diana|feminine|Adult|Peninsular|Professional, Confident, Expressive, Polite, Knowledgeable|Storytelling, Advertising
aquila|masculine|Adult|Latin American|Expressive, Enthusiastic, Confident, Casual, Comfortable|Casual Chat, Informative
selena|feminine|Young Adult|Latin American|Approachable, Casual, Friendly, Calm, Positive|Customer Service, Informative
javier|masculine|Adult|Mexican|Approachable, Professional, Friendly, Comfortable, Calm|Casual Chat, IVR, Storytelling
agustina|feminine|Adult|Peninsular|Calm, Clear, Expressive, Knowledgeable, Professional|Interview, Casual Chat
antonia|feminine|Adult|Argentine|Approachable, Enthusiastic, Friendly, Natural, Professional|Customer Service, Interview, Casual Chat
gloria|feminine|Young Adult|Colombian|Casual, Clear, Expressive, Natural, Smooth|Customer Service, Casual Chat
luciano|masculine|Adult|Mexican|Charismatic, Cheerful, Energetic, Expressive, Friendly|Customer Service, Casual Chat
olivia|feminine|Adult|Mexican|Breathy, Calm, Casual, Expressive, Warm|Customer Service, Casual Chat
silvia|feminine|Adult|Peninsular|Charismatic, Clear, Expressive, Natural, Warm|Customer Service, Casual Chat
valerio|masculine|Adult|Mexican|Deep, Knowledgeable, Natural, Polite, Professional|Customer Service, Informative
`;

const AURA_2_DE = `
julius|masculine|Adult|German|Casual, Cheerful, Engaging, Expressive, Friendly|Healthcare, Customer Service, Sales, Financial Services
viktoria|feminine|Adult|German|Charismatic, Cheerful, Enthusiastic, Friendly, Warm|Healthcare, Customer Service, Sales, Financial Services
elara|feminine|Adult|German|Calm, Clear, Natural, Patient, Trustworthy|Healthcare, Customer Service, Sales, Financial Services
aurelia|feminine|Young Adult|German|Approachable, Casual, Comfortable, Natural, Sincere|Healthcare, Customer Service, Sales, Financial Services
lara|feminine|Young Adult|German|Caring, Cheerful, Empathetic, Expressive, Warm|Healthcare, Customer Service, Sales, Financial Services
fabian|masculine|Mature|German|Confident, Knowledgeable, Natural, Polite, Professional|Healthcare, Customer Service, Sales, Financial Services
kara|feminine|Young Adult|German|Caring, Empathetic, Expressive, Professional, Warm|Healthcare, Customer Service, Sales, Financial Services
`;

const AURA_2_FR = `
agathe|feminine|Adult|French|Charismatic, Cheerful, Enthusiastic, Friendly, Natural|Customer Service
hector|masculine|Adult|French|Confident, Empathetic, Expressive, Friendly, Patient|Customer Service
`;

const AURA_2_NL = `
rhea|feminine|Adult|Dutch|Caring, Knowledgeable, Positive, Smooth, Warm|Customer Service
sander|masculine|Adult|Dutch|Calm, Clear, Deep, Professional, Smooth|Customer Service
beatrix|feminine|Adult|Dutch|Cheerful, Enthusiastic, Friendly, Trustworthy, Warm|Customer Service
daphne|feminine|Adult|Dutch|Calm, Clear, Confident, Professional, Smooth|Healthcare, Interview, Casual Chat, Audiobook
cornelia|feminine|Adult|Dutch|Approachable, Friendly, Polite, Positive, Warm|Customer Service
hestia|feminine|Adult|Dutch|Approachable, Caring, Expressive, Friendly, Knowledgeable|Customer Service
lars|masculine|Adult|Dutch|Breathy, Casual, Comfortable, Sincere, Trustworthy|Customer Service
roman|masculine|Adult|Dutch|Calm, Casual, Deep, Natural, Patient|Customer Service
leda|feminine|Adult|Dutch|Caring, Comfortable, Empathetic, Friendly, Sincere|Sales
`;

const AURA_2_IT = `
livia|feminine|Adult|Italian|Approachable, Cheerful, Clear, Engaging, Expressive|Customer Service, Interview, Audiobook
dionisio|masculine|Adult|Italian|Confident, Engaging, Friendly, Melodic, Positive|Interview, Casual Chat, Customer Service
melia|feminine|Adult|Italian|Clear, Comfortable, Engaging, Friendly, Natural|Casual Chat, Customer Service, Interview
elio|masculine|Adult|Italian|Breathy, Calm, Professional, Smooth, Trustworthy|Interview, Casual Chat, Customer Service
flavio|masculine|Adult|Italian|Confident, Deep, Empathetic, Professional, Trustworthy|Casual Chat, Interview, Customer Service
maia|feminine|Young Adult|Italian|Caring, Energetic, Expressive, Professional, Warm|Interview, Casual Chat, Customer Service
cinzia|feminine|Mature|Italian|Approachable, Friendly, Smooth, Trustworthy, Warm|Customer Service, Interview, Narration
cesare|masculine|Adult|Italian|Clear, Empathetic, Knowledgeable, Natural, Smooth|Casual Chat, Customer Service, Interview, IVR
demetra|feminine|Adult|Italian|Calm, Comfortable, Patient|Casual Chat, Interview, Narration
`;

const AURA_2_JA = `
fujin|masculine|Adult|Japanese|Calm, Confident, Knowledgeable, Professional, Smooth|Interview, Casual Chat, IVR
izanami|feminine|Adult|Japanese|Approachable, Clear, Knowledgeable, Polite, Professional|Casual Chat, Customer Service, Interview, IVR
uzume|feminine|Young Adult|Japanese|Approachable, Clear, Polite, Professional, Trustworthy|Customer Service, Interview, IVR, Commercial
ebisu|masculine|Young Adult|Japanese|Calm, Deep, Natural, Patient, Sincere|Casual Chat, Customer Service
ama|feminine|Adult|Japanese|Casual, Comfortable, Confident, Knowledgeable, Natural|Interview, IVR
`;

const AURA_1_EN = `
asteria|feminine|Adult|American|Clear, Confident, Knowledgeable, Energetic|Advertising
luna|feminine|Young Adult|American|Friendly, Natural, Engaging|IVR
stella|feminine|Adult|American|Clear, Professional, Engaging|Customer service
athena|feminine|Mature|British|Calm, Smooth, Professional|Storytelling
hera|feminine|Adult|American|Smooth, Warm, Professional|Informative
orion|masculine|Adult|American|Approachable, Comfortable, Calm, Polite|Informative
arcas|masculine|Adult|American|Natural, Smooth, Clear, Comfortable|Customer service, casual chat
perseus|masculine|Adult|American|Confident, Professional, Clear|Customer service
angus|masculine|Adult|Irish|Warm, Friendly, Natural|Storytelling
orpheus|masculine|Adult|American|Professional, Clear, Confident, Trustworthy|Customer service, storytelling
helios|masculine|Adult|British|Professional, Clear, Confident|Customer service
zeus|masculine|Adult|American|Deep, Trustworthy, Smooth|IVR
`;

/** `thalia-en`: the voice part of a model string, which Generate Speech stores as `voiceId`. */
function parse(block: string, language: string, category: string): VoiceInfo[] {
  return block
    .trim()
    .split('\n')
    .map((line) => {
      const [name, gender, age, accent, traits, uses] = line.split('|');
      return {
        id: `${name}-${language}`,
        name: name!.charAt(0).toUpperCase() + name!.slice(1),
        gender: gender === 'feminine' ? 'female' : gender === 'masculine' ? 'male' : gender!,
        age: age!,
        accent: accent!,
        languages: [language],
        ...(traits && { description: traits }),
        ...(uses && { useCases: uses.split(', ') }),
        category,
      };
    });
}

export const FLUX_VOICES = parse(FLUX_EN, 'en', 'Flux');
export const AURA_2_VOICES = [
  ...parse(AURA_2_EN, 'en', 'Aura-2'),
  ...parse(AURA_2_ES, 'es', 'Aura-2'),
  ...parse(AURA_2_DE, 'de', 'Aura-2'),
  ...parse(AURA_2_FR, 'fr', 'Aura-2'),
  ...parse(AURA_2_NL, 'nl', 'Aura-2'),
  ...parse(AURA_2_IT, 'it', 'Aura-2'),
  ...parse(AURA_2_JA, 'ja', 'Aura-2'),
];
export const AURA_1_VOICES = parse(AURA_1_EN, 'en', 'Aura');
