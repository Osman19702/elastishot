@cli
Feature: E — Reports that travel
  As someone sharing results with a team
  I want a summary page, a detail page per pair, machine-readable JSON and JUnit
  So that people and CI can both read the outcome

  Background:
    Given a run folder produced by comparing a page image with a collapsed version of it

  Scenario: E1 — The summary page has a card per pair
    Then index.html has one card with a status pill, a similarity score and thumbnails
    And the card links to the pair page

  Scenario: E2 — The pair page lists every region
    Then report.html has one table row per region
    And the viewer element is embedded with the baseline, candidate, diff and warped images

  Scenario: E3 — report.json is the machine-readable source of both pages
    Then report.json carries the schema, totals, the pair summary, its regions and its alignment

  Scenario: E4 — junit.xml has a testcase per pair
    Then junit.xml has one testcase, marked failed with the reasons in its message

  Scenario: E5 — A single-file report has no external references
    When the same comparison runs with --single-file
    Then the pages reference no files, only data URIs
