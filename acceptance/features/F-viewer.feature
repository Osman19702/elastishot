@browser
Feature: F — Looking at a difference
  As someone judging a change
  I want to slide, flip, blink and overlay the two images and click a region to see its locator
  So that I can tell a real regression from noise

  Background:
    Given a pair page opened from a run folder in a browser

  Scenario: F1 — The slider handle is keyboard operable
    When I focus the handle and press the arrow keys
    Then the handle reports its position and the candidate reveal follows it

  Scenario: F2 — Modes switch from the page toolbar
    When I click Diff, Overlay, Flip and Blink in the page toolbar
    Then the viewer switches mode each time without errors

  Scenario: F3 — Clicking a region shows what it is
    When I click a region box
    Then a chip shows the region kind and score
    And the matching row of the region table is highlighted
