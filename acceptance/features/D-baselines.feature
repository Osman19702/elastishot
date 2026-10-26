@browser @cli
Feature: D — Tracking a URL across deployments
  As someone gating deployments
  I want to keep a baseline per page and viewport, compare new deployments against it and approve changes
  So that a run tells me whether the UI drifted since the last approved version

  Background:
    Given a config with one target and one viewport pointing at version 1

  Scenario: D1 — snapshot writes a baseline folder
    When I run snapshot for the page URL with a name
    Then the baseline folder holds baseline.png, baseline.map.json and meta.json

  Scenario: D2 — A target without a baseline is new until --update creates it
    When I run the configured targets without a baseline
    Then the pair is reported as new and the command exits with 1
    When I run again with --update
    Then the baseline is written and the command exits with 0

  Scenario: D3 — A changed deployment fails, approve promotes it, the next run passes
    Given the baseline was taken from version 1
    When the target now points at version 2 and I run
    Then the command exits with 1 and names the changed locators
    When I approve the target
    Then the baseline meta records the approval
    And running again exits with 0

  Scenario: D4 — A run with --single-file can still be approved
    Given the baseline was taken from version 2
    When the target points at version 1 and I run with --single-file
    Then the command exits with 1
    When I approve the target
    Then the next run exits with 0

  Scenario: D5 — An ad-hoc compare between run and approve does not lose the run
    Given a run against version 2 failed
    When I compare two images before approving
    And I approve the target
    Then the candidate of that run is promoted and a note names the run used
    And the next run exits with 0

  Scenario: D6 — run --update --force replaces a baseline that drifted
    Given the baseline was taken from version 2
    When the target points at version 1 and I run with --update --force
    Then the command exits with 0 and the pair says its baseline was replaced
    And the next run exits with 0
