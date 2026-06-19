import MDXComponents from '@theme-original/MDXComponents';
import VideoEmbed from '@site/src/components/VideoEmbed';
import TutorialCard from '@site/src/components/TutorialCard';
import AITutorialSearch from '@site/src/components/AITutorialSearch';

// Componentes disponíveis globalmente em qualquer .md/.mdx, sem precisar de import.
export default {
  ...MDXComponents,
  VideoEmbed,
  TutorialCard,
  AITutorialSearch,
};
