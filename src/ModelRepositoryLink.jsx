import { Github } from 'lucide-react';
import './model-repository-link.css';

const MODEL_REPOSITORY_URL = 'https://github.com/XinzeLee/AI4PE-explorer';

export function ModelRepositoryLink() {
  return <a className="model-repo-link" href={MODEL_REPOSITORY_URL} target="_blank" rel="noopener noreferrer" aria-label="Model repository on GitHub" title="Model repository on GitHub"><Github size={20} aria-hidden="true" /></a>;
}
