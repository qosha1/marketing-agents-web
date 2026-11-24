'use client';

import { useParams } from 'next/navigation';

import { ProjectPage } from '@/components/projects/project-page';

export default function ProjectRoute() {
  const { id } = useParams<{ id: string }>();
  return <ProjectPage id={id} />;
}
