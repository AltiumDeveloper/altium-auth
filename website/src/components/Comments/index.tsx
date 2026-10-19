import React, { type ReactNode } from 'react';
import Giscus from '@giscus/react';
import { useColorMode } from '@docusaurus/theme-common';

// Comments via giscus (GitHub Discussions, "Comments" category of this repo). Threads are keyed by the page
// pathname, so they carry over from the MkDocs site as long as URLs keep their trailing slash.
export default function Comments(): ReactNode {
  const { colorMode } = useColorMode();
  return (
    <Giscus
      repo="AltiumDeveloper/altium-auth"
      repoId="R_kgDOTSXlXQ"
      category="Comments"
      categoryId="DIC_kwDOTSXlXc4DA1sE"
      mapping="pathname"
      strict="1"
      reactionsEnabled="1"
      emitMetadata="0"
      inputPosition="top"
      theme={colorMode === 'dark' ? 'dark' : 'light'}
      lang="en"
      loading="lazy"
    />
  );
}
