import type { Lang } from './models';

export const PRESETS: Record<Lang, { label: string; text: string }[]> = {
  en: [
    {
      label: 'Everyday',
      text: 'This morning I missed the bus, so I walked to the office instead. The air was cold but clear, and by the time I arrived I had already planned the whole day. Sometimes a small change of routine is exactly what you need.',
    },
    {
      label: 'Numbers & names',
      text: "The meeting is on Thursday, the fourteenth of November, at half past three. Please bring the report, two printed copies of the budget, and the slides Maria shared last week. If anything changes, I'll send an update before noon.",
    },
  ],
  pt: [
    {
      label: 'Quotidiano',
      text: 'Hoje de manhã perdi o autocarro e acabei por ir a pé até ao escritório. Estava frio, mas o céu estava limpo, e quando cheguei já tinha o dia todo planeado. Às vezes, uma pequena mudança na rotina é mesmo aquilo de que precisamos.',
    },
    {
      label: 'Números e nomes',
      text: 'A reunião é na quinta-feira, dia catorze de novembro, às três e meia da tarde. Traz o relatório, duas cópias impressas do orçamento e os diapositivos que a Joana partilhou na semana passada. Se houver alguma alteração, mando-te uma mensagem pelo telemóvel antes do almoço.',
    },
  ],
};
