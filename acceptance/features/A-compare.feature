@cli
Feature: A — Comparing two images or two pages
  As someone reviewing a UI change
  I want to compare two screenshots, or two versions of a page, of any size
  So that I see what changed even when the layout zoomed, collapsed or resized

  Background:
    Given the elastishot command line is installed

  Scenario: A1 — Two identical images pass
    When I compare an image with itself
    Then the command exits with 0
    And the pair is reported as passed with no regions

  Scenario: A2 — A collapsed section is reported as removed
    When I compare a page image with the same image minus one section
    Then the command exits with 1
    And a removed region covers the missing section
    And nothing below the section is reported as changed

  Scenario: A3 — Images of different sizes are aligned before comparing
    When I compare a full page image with a 320x320 crop of the same page shrunk to 40%
    Then the command exits without a runtime error
    And the alignment scale is about 2.5
    And no changed region is reported inside the shared area

  Scenario: A4 — Two versions of a page are captured and compared by URL
    When I compare the URL of version 1 with the URL of version 2 of a page
    Then the command exits with 1
    And the report names the collapsed FAQ, the zoomed illustration, the renamed button and the new badge
