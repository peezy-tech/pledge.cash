import { createRoute, RootRoute } from '@tanstack/react-router';
import PlayGameComponent from './PlayGame.tsx';

// Helper function to create the route
const createPlayGameRoute = (root: RootRoute) => {
  return createRoute({
    getParentRoute: () => root,
    path: '/play-game',
    component: PlayGameComponent,
    // It's good practice to define search param validation if you expect specific params
    validateSearch: (search: Record<string, unknown>): { url?: string } => {
      return {
        url: typeof search.url === 'string' ? search.url : undefined,
      };
    },
  });
};

export default createPlayGameRoute; 