import React, { type ReactNode } from 'react';
import DocBreadcrumbs from '@theme-original/DocBreadcrumbs';
import type DocBreadcrumbsType from '@theme/DocBreadcrumbs';
import type { WrapperProps } from '@docusaurus/types';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { useDoc } from '@docusaurus/plugin-content-docs/client';
import { markdownHref } from '../markdownRoute';

type Props = WrapperProps<typeof DocBreadcrumbsType>;

// A small "View as Markdown" link on the breadcrumbs row of every doc page. The Markdown twins are written by
// `npm run llms` after the build, so this is a plain <a> (a router <Link> would fail the broken-link check). It
// sits in the breadcrumbs row, outside `.theme-doc-markdown`, so the Markdown conversion never sees it.
export default function DocBreadcrumbsWrapper(props: Props): ReactNode {
  const { metadata } = useDoc();
  const { siteConfig } = useDocusaurusContext();
  const href = markdownHref(metadata.permalink, siteConfig.baseUrl);
  return (
    <div className="doc-markdown-row">
      <div className="doc-markdown-row__crumbs">
        <DocBreadcrumbs {...props} />
      </div>
      <a className="doc-markdown-link" href={href} title="Markdown version of this page for AI assistants">
        View as Markdown
      </a>
    </div>
  );
}
