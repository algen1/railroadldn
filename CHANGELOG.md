# Changelog

## 2026-10-30 — Glass UI and live journey guidance

- Added a translucent glass-style interface with rounded controls, soft highlights, blur and accessibility fallbacks.
- Added line names and colour indicators to station search suggestions, including interchange stations.
- Made Leave now automatically select the earliest suitable train reaching the boarding station in the correct direction.
- Added a clickable Catch this train marker following the selected train, with boarding and destination names.
- Unified journey-option times, the Leave by time, blue live times and live train cards so selecting a departure isolates that service.
- Kept other trains and unrelated route lines hidden during matching, map clicks and station inspection.
- Retained the selected train’s last reported position during missing feed updates, clearly labelled as waiting for a live update.
- Added line-coloured journey routes, boarding and destination markers, change-station labels and dashed walking connections.
- Fixed walking allowances restarting on refresh and connection checks rejecting earlier trains that still allow the transfer.
- Restricted Catch this train guidance to verified journey matches; ordinary map selections only inspect a train.
- Made arrival countdowns use current expected arrival timestamps.

### Validation

- Production build and journey regression checks pass.
- Component-handler regression checks cover all departure controls, isolation, missing updates and ordinary map selections.
- Journey-map checks cover line colours, coordinate order and interchange labels.
- Browser checks included Ruislip Gardens to North Acton, Edgware Road to Brixton via Oxford Circus, and Oxford Circus to Bank.
- Lint completes with React warnings; the production build reports a large JavaScript bundle warning.

### Live data limits

TfL predictions determine which trains can be matched. When no service has suitable live predictions, Railroom waits rather than recommending an unverified train. Positions are inferred from predictions and route geometry, not GPS.
