// sync_repos.js
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'repos.json');

async function execCommand(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf8', ...options });
  } catch (error) {
    if (options.ignoreError) {
      return '';
    }
    throw error;
  }
}

async function syncRepo(repo) {
  console.log(`\nSyncing ${repo.name}...`);
  
  try {
    const localPath = path.resolve(repo.localPath);
    
    // Initialize upstream remote if it doesn't exist
    try {
      await execCommand(`git remote get-url ${repo.name}-upstream`, { stdio: 'pipe' });
    } catch {
      await execCommand(`git remote add ${repo.name}-upstream ${repo.upstreamUrl}`);
    }
    
    // Fetch latest from upstream
    await execCommand(`git fetch ${repo.name}-upstream`);
    
    // Create temporary worktree
    const tmpDir = path.join(process.cwd(), `.tmp-${repo.name}-${Date.now()}`);
    await execCommand(`git worktree add ${tmpDir} ${repo.name}-upstream/${repo.branch || 'main'}`);
    
    try {
      // Copy files from worktree to localPath
      await execCommand(`cp -r ${tmpDir}/* ${localPath}/`);
      
      // Stage all changes
      await execCommand(`git add ${localPath}`);
      
      // Check if there are any changes
      const status = await execCommand('git status --porcelain');
      
      if (status.trim()) {
        console.log(`\nChanges detected for ${repo.name}. Review the changes with:`);
        console.log('  git diff --staged');
        console.log('\nTo commit the changes:');
        console.log('  git commit -m "sync: Update from upstream"');
        console.log('\nTo discard the changes:');
        console.log('  git reset HEAD');
      } else {
        console.log(`\nNo changes detected for ${repo.name}`);
      }
      
    } finally {
      // Clean up worktree
      await execCommand(`git worktree remove ${tmpDir}`, { ignoreError: true });
      // Remove tmp directory if it still exists
      await execCommand(`rm -rf ${tmpDir}`, { ignoreError: true });
    }
    
  } catch (error) {
    console.error(`Error syncing ${repo.name}:`, error.message);
    if (error.stderr) console.error(error.stderr);
  }
}

async function validateConfig(config) {
  if (!config.repos || !Array.isArray(config.repos)) {
    throw new Error('Config must contain a "repos" array');
  }
  
  for (const repo of config.repos) {
    if (!repo.name) throw new Error('Each repo must have a name');
    if (!repo.upstreamUrl) throw new Error(`Repo ${repo.name} must have an upstreamUrl`);
    if (!repo.localPath) throw new Error(`Repo ${repo.name} must have a localPath`);
  }
}

async function main() {
  try {
    // Ensure we're in a git repository
    try {
      await execCommand('git rev-parse --git-dir');
    } catch {
      throw new Error('Current directory is not a git repository');
    }
    
    // Read and validate config
    const configContent = await fs.readFile(CONFIG_PATH, 'utf8');
    const config = JSON.parse(configContent);
    await validateConfig(config);
    
    // Process each repo
    for (const repo of config.repos) {
      await syncRepo(repo);
    }
    
    console.log('\nSync complete. Review staged changes with:');
    console.log('  git diff --staged');
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
