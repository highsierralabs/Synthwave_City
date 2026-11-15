// Entry point of the shipped page.
import { boot } from './app/app';

boot().catch((error: unknown) => {
  console.error(error);
  const message = document.getElementById('message');
  if (message) message.textContent = `The city could not be started: ${error instanceof Error ? error.message : String(error)}`;
  document.body.dataset['state'] = 'error';
  const flags = window as unknown as { __SC_READY?: boolean; __SC_ERRORS?: string[] };
  (flags.__SC_ERRORS ??= []).push('boot failed');
  flags.__SC_READY = true;
});
