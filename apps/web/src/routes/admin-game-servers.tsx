import { createRoute, RootRoute } from '@tanstack/react-router';
import AdminGameServersComponent from './AdminGameServers.tsx'; // Corrected import path

// Helper function to create the route
const createAdminGameServersRoute = (root: RootRoute) => {
  return createRoute({
    getParentRoute: () => root,
    path: '/admin/game-servers',
    component: AdminGameServersComponent,
  });
};

export default createAdminGameServersRoute; 