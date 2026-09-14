@cli
Feature: G — Behaving well in a pipeline
  As someone wiring elastishot into CI
  I want predictable exit codes, machine-readable output and clear usage errors
  So that a job can gate on the result without parsing prose

  Scenario: G1 — --json prints one parseable object and nothing else
    When I compare two images with --json
    Then stdout is exactly one JSON document
    And it is the same report that was written to the run folder

  Scenario: G2 — --quiet prints only the summary line
    When I compare two images with --quiet
    Then stdout is a single line with the pass and fail counts

  Scenario: G3 — Unknown flags, commands and bad values exit 2 with usage
    When I run with an unknown flag, an unknown command, or a viewport that is not WxH
    Then each exits with 2 and prints the usage

  Scenario: G4 — --fail-on none with a low threshold passes despite regions
    When I compare two different images with --fail-on none --threshold 0.5
    Then the command exits with 0 while still listing the regions

  Scenario: G5 — --help and --version exit 0
    When I run --help and --version
    Then both exit with 0

  Scenario: G6 — run honours --threshold and --fail-on
    Given a target whose baseline is version 1 of a page
    When I run against version 2 with --threshold 0.5 --fail-on none
    Then the command exits with 0
    And the same run without the flags exits with 1
