/** href -> stable data-tour hook on the matching Sidebar nav link, so
 *  OnboardingTour can spotlight the real nav item a step talks about instead
 *  of a fragile text/position selector. Shared (not just a Sidebar-local
 *  const) so OnboardingTour's tests don't have to import Sidebar's full
 *  component tree just to read this mapping. */
export const NAV_TOUR_TARGETS: Record<string, string> = {
  "/journey":   "nav-journey",
  "/lms":       "nav-lms",
  "/coach":     "nav-coach",
  "/simulator": "nav-simulator",
}
