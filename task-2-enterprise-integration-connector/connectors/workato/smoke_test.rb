#!/usr/bin/env ruby
# frozen_string_literal: true

# Lightweight, LOCAL smoke-test harness -- NOT a substitute for the real
# `workato-connector-sdk` gem (which could not be installed in the
# sandbox this connector was built in; see VALIDATION.md). This script
# stubs just enough of the SDK's DSL (get/post/headers/error, and the
# chainable .payload/.after_error_response/.response_format_raw) to
# actually CALL each action's execute lambda and each trigger's poll
# lambda with representative fake input, and checks that:
#   1. connector.rb evaluates as valid Ruby (already proven by `ruby -c`)
#   2. every execute/poll lambda runs to completion without a Ruby
#      runtime error (NoMethodError, ArgumentError, etc.) against
#      representative canned HTTP responses
#   3. each lambda's return shape has the keys its output_fields declare
#
# This catches real bugs in the connector's own Ruby logic (wrong method
# chaining, typoed hash keys, wrong argument counts) that a bracket-count
# or `ruby -c` syntax check cannot catch. It does NOT prove the lambdas
# are semantically correct against Workato's real production DSL
# behavior (e.g. real retry_on_response wiring, real closure semantics
# across actual poll intervals, real error() job-failure behavior) --
# only `workato exec` / `workato push` against the real gem can prove
# that. See VALIDATION.md.

require "json"
require "base64"

# Workato's real runtime is built on Rails/ActiveSupport, which is why
# real connector code (including the docs' own worked examples, e.g.
# `input['since'] || 1.hours.ago`, `data.blank?`) freely uses
# `.present?`/`.blank?` on plain objects. ActiveSupport itself could not
# be installed here (rubygems.org is not reachable in this sandbox --
# see VALIDATION.md), so this harness adds the minimal, standard
# ActiveSupport-compatible semantics for just these two methods, purely
# so the smoke test can execute connector.rb's actual lambda bodies
# unmodified. This is a test-harness shim, not a claim that full
# ActiveSupport behavior is being validated.
class NilClass
  def blank? = true
  def present? = false
end

class Object
  def blank?
    respond_to?(:empty?) ? !!empty? : !self
  end

  def present?
    !blank?
  end

  def presence
    present? ? self : nil
  end
end

class FalseClass
  def blank? = true
end

class TrueClass
  def blank? = false
end

class StubResponse
  def initialize(body)
    @body = body
  end

  def payload(_hash)
    self
  end

  def response_format_raw
    @body = @body.is_a?(String) ? @body : @body.to_json
    self
  end

  def after_error_response(_pattern)
    # Happy-path stub: never simulates an error branch. Error-path
    # coverage lives in tests/ (the JS core), which every platform
    # adapter delegates its actual HTTP/retry/error logic to.
    @body
  end

  # Support both `post(...).payload(...)` returning a Hash directly (no
  # after_error_response called) and the chained form.
  def method_missing(name, *args, &block)
    @body.respond_to?(name) ? @body.send(name, *args, &block) : super
  end

  def respond_to_missing?(name, include_private = false)
    @body.respond_to?(name, include_private) || super
  end
end

# --- Canned fake HTTP responses, keyed by "METHOD path" -------------
FAKE_RESPONSES = {
  "GET /v1/sessions" => { "sessions" => [] },
  "POST /v1/chat" => { "response" => "ok", "document_changes" => { "updated_html" => "<h1>Fake generated doc</h1>" } },
  "POST /v1/chat/async" => { "job_id" => "job-fake-1", "session_id" => "sess-fake-1", "status" => "pending" },
  "GET /v1/jobs/job-fake-1" => {
    "job_id" => "job-fake-1",
    "status" => "completed",
    "result" => { "response" => "done", "document_changes" => { "updated_html" => "<h1>Edited</h1>" } }
  },
  "POST /v1/chat/sess-fake-1/approve" => { "status" => "in_progress" },
  "POST /v1/documents/export" => "FAKE_BINARY_DOCX_BYTES"
}.freeze

def get(path)
  StubResponse.new(FAKE_RESPONSES.fetch("GET #{path}") { raise "No stub for GET #{path}" })
end

def post(path)
  StubResponse.new(FAKE_RESPONSES.fetch("POST #{path}") { raise "No stub for POST #{path}" })
end

def headers(_hash)
  {} # apply: lambda's return value; unused by this harness
end

def error(message)
  raise "connector called error(): #{message}"
end

connector = eval(File.read(File.join(__dir__, "connector.rb")))

failures = []

def check(label, failures)
  yield
  puts "  OK  #{label}"
rescue StandardError => e
  failures << "#{label}: #{e.class}: #{e.message}"
  puts "FAIL  #{label}: #{e.class}: #{e.message}"
end

puts "== test lambda =="
check("connection test", failures) do
  result = connector[:connection][:authorization][:apply].call({ "api_key" => "sk_fake" })
  raise "apply did not run" unless result.is_a?(Hash)
  connector[:test].call({ "api_key" => "sk_fake" })
end

puts "\n== action: generate_from_template =="
check("generate_from_template execute", failures) do
  out = connector[:actions][:generate_from_template][:execute].call(
    {}, { "template_name" => "Invoice Template", "session_id" => "sess-fake-1", "substitution_data" => { "customer" => "Acme" } }
  )
  raise "missing document_html" unless out["document_html"]
  raise "wrong status" unless out["status"] == "completed"
end

puts "\n== action: edit_by_instruction =="
check("edit_by_instruction execute", failures) do
  out = connector[:actions][:edit_by_instruction][:execute].call(
    {}, { "session_id" => "sess-fake-1", "instruction" => "Add a clause", "approval_mode" => "approve_all" }
  )
  raise "missing job_id" unless out["job_id"] == "job-fake-1"
  raise "wrong status" unless out["status"] == "pending"
end

puts "\n== action: submit_for_approval =="
check("submit_for_approval execute (single change)", failures) do
  out = connector[:actions][:submit_for_approval][:execute].call(
    {}, { "session_id" => "sess-fake-1", "job_id" => "job-fake-1", "default_approved" => "true", "change_id" => "ch_1" }
  )
  raise "wrong status" unless out["status"] == "in_progress"
end
check("submit_for_approval rejects change_id + changes together", failures) do
  begin
    connector[:actions][:submit_for_approval][:execute].call(
      {}, { "session_id" => "s", "job_id" => "j", "default_approved" => "true", "change_id" => "ch_1", "changes" => [{ "change_id" => "ch_2" }] }
    )
    raise "did not raise -- validation was supposed to reject this input"
  rescue RuntimeError => e
    raise unless e.message.include?("not both")
  end
end

puts "\n== action: poll_job_status =="
check("poll_job_status execute", failures) do
  out = connector[:actions][:poll_job_status][:execute].call({}, { "job_id" => "job-fake-1" })
  raise "wrong status" unless out["status"] == "completed"
  raise "missing updated_html" unless out["updated_html"] == "<h1>Edited</h1>"
end

puts "\n== action: fetch_export =="
check("fetch_export execute", failures) do
  out = connector[:actions][:fetch_export][:execute].call({}, { "session_id" => "sess-fake-1", "format" => "docx" })
  raise "missing file_base64" unless out["file_base64"]
  decoded = Base64.strict_decode64(out["file_base64"])
  raise "round-trip mismatch" unless decoded == "FAKE_BINARY_DOCX_BYTES"
end

puts "\n== trigger: new_or_updated_job_status (poll) =="
check("poll trigger: first poll emits an event (closure starts empty)", failures) do
  out = connector[:triggers][:new_or_updated_job_status][:poll].call({}, { "job_id" => "job-fake-1" }, nil, nil, nil)
  raise "expected 1 event on first poll" unless out[:events].length == 1
  raise "expected can_poll_more=false for a completed job" if out[:can_poll_more]
  raise "closure missing last_status" unless out[:next_poll]["last_status"] == "completed"
end
check("poll trigger: second poll with unchanged status emits no event (dedup-by-status)", failures) do
  out = connector[:triggers][:new_or_updated_job_status][:poll].call({}, { "job_id" => "job-fake-1" }, { "last_status" => "completed" }, nil, nil)
  raise "expected 0 events when status is unchanged" unless out[:events].empty?
end
check("dedup lambda produces a stable per-status key", failures) do
  key = connector[:triggers][:new_or_updated_job_status][:dedup].call({ "job_id" => "job-fake-1", "status" => "completed" })
  raise "unexpected dedup key" unless key == "job-fake-1@completed"
end

puts "\n#{failures.empty? ? 'ALL CHECKS PASSED' : "#{failures.length} FAILURE(S):"}"
failures.each { |f| puts "  - #{f}" }
exit(failures.empty? ? 0 : 1)
