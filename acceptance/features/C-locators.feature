@browser @cli
Feature: C — Naming what changed
  As someone reading a comparison report
  I want every difference attributed to the element behind it
  So that I can go straight to the component that changed

  Background:
    Given version 1 and version 2 of a page are served locally
    And the two versions have been compared by URL

  Scenario: C1 — A collapsed section is attributed to the section
    Then the removed regions are attributed to the FAQ element or its content list
    And that locator has pixel evidence

  Scenario: C2 — A renamed button keeps its locator and shows both names
    Then the call to action is reported as changed under its test id
    And the report shows the old and the new button text

  Scenario: C3 — A new element is reported as added and candidate-only
    Then the footer badge is reported as added
    And its presence is candidate-only

  Scenario: C4 — Plain images still produce a report, without names
    When I compare two plain PNG files
    Then the report says no element maps were available
    And the regions are still listed with their boxes
