import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Cross-fade between pages (browsers without View Transitions just navigate as before).
    defaultViewTransition: true,
    // Links like /#house glide there; restoring a saved scroll position on Back must not animate.
    defaultHashScrollIntoView: { behavior: "smooth", block: "start" },
    scrollRestorationBehavior: "instant",
  });

  return router;
};
