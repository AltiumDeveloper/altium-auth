import React, { type ReactNode } from 'react';
import Metadata from '@theme-original/DocItem/Metadata';
import type MetadataType from '@theme/DocItem/Metadata';
import type { WrapperProps } from '@docusaurus/types';
import Head from '@docusaurus/Head';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { useDoc } from '@docusaurus/plugin-content-docs/client';
import { markdownHref } from '../../markdownRoute';

type Props = WrapperProps<typeof MetadataType>;

// Every doc page advertises its Markdown twin, written by `npm run llms` next to the HTML.
export default function MetadataWrapper(props: Props): ReactNode {
  const { metadata } = useDoc();
  const { siteConfig } = useDocusaurusContext();
  const href = markdownHref(metadata.permalink, siteConfig.baseUrl);
  return (
    <>
      <Metadata {...props} />
      <Head>
        <link rel="alternate" type="text/markdown" href={href} />
      </Head>
    </>
  );
}
