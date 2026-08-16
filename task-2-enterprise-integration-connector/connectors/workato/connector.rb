# frozen_string_literal: true

# SuperDocs connector for the Workato Connector SDK.
#
# SYNTAX/CONVENTIONS VERIFIED AGAINST REAL, PUBLIC WORKATO DOCUMENTATION on
# 2026-08-15 -- see ../../docs/workato-sdk-notes.md for the exact source
# page behind every convention used below (connection/authorization shape,
# actions.input_fields/execute/output_fields, retry_on_response /
# retry_on_request / max_retries, error(), after_error_response, and the
# poll trigger shape with events/next_poll/can_poll_more/dedup). Nothing
# here is invented syntax.
#
# NOT VALIDATED BY THE ACTUAL `workato-connector-sdk` GEM. See
# ../VALIDATION.md for exactly why (Ruby is not installed and
# rubygems.org is not reachable in the sandbox this was built in) and the
# precise commands to run to complete validation before this PR is
# merged. Every endpoint path, request field, and response field this
# file references is verified against docs.superdocs.app instead (see
# docs/api-notes.md at the project root) -- what's unverified is
# specifically Ruby/DSL syntax correctness under the real gem, not the
# SuperDocs API contract itself.

{
  title: "SuperDocs",

  # ---------------------------------------------------------------
  # Connection
  # ---------------------------------------------------------------
  # Verified pattern: docs.workato.com/developing-connectors/sdk/guides/authentication/api-key.html
  # SuperDocs itself documents `Authorization: Bearer sk_...` (or lce_...
  # for org keys) -- see https://docs.superdocs.app/account/api-keys --
  # which is the Bearer-header pattern, not the bare api_key auth type,
  # so this uses custom_auth (matches the verified header-auth guide at
  # docs.workato.com/developing-connectors/sdk/guides/authentication/header-auth.html)
  # rather than Workato's built-in `api_key` type, which sends the raw
  # key without a "Bearer " prefix by default.
  connection: {
    fields: [
      {
        name: "api_key",
        label: "SuperDocs API key",
        control_type: "password",
        optional: false,
        hint: "An sk_... key from SuperDocs Settings > API Keys, or an lce_... " \
              "organization key. Both use the identical Bearer auth scheme."
      }
    ],

    authorization: {
      type: "custom_auth",

      apply: lambda do |connection|
        headers("Authorization": "Bearer #{connection['api_key']}")
      end
    },

    base_uri: lambda do |_connection|
      "https://api.superdocs.app"
    end
  },

  # `test` -- the connection-verification call. GET /v1/sessions is the
  # documented "cheapest way to confirm a key works": consumes no
  # operations, returns immediately, and explicitly accepts sk_/lce_ keys
  # (unlike /v1/users/me, which the docs warn rejects API keys with a
  # misleading 401). Source: docs.superdocs.app/account/api-keys.
  test: lambda do |_connection|
    get("/v1/sessions")
  end,

  # ---------------------------------------------------------------
  # Object definitions (shared typed schemas across actions)
  # ---------------------------------------------------------------
  object_definitions: {
    pending_change: {
      fields: lambda do |_connection, _config_fields|
        [
          { name: "change_id" },
          { name: "operation", control_type: "select", pick_list: [%w[Edit edit], %w[Create create], %w[Delete delete]] },
          { name: "chunk_id" },
          { name: "old_html" },
          { name: "new_html" },
          { name: "ai_explanation" },
          { name: "insert_after_chunk_id" }
        ]
      end
    },

    job_status: {
      fields: lambda do |_connection, _config_fields|
        [
          { name: "job_id" },
          { name: "status", control_type: "select",
            pick_list: [%w[Pending pending], %w[In\ progress in_progress], %w[Awaiting\ approval awaiting_approval],
                        %w[Completed completed], %w[Failed failed], %w[Cancelled cancelled]] },
          { name: "awaiting_kind" },
          { name: "updated_html" },
          { name: "error_message" },
          { name: "pending_changes", type: "array", of: "object", properties: [] } # populated via object_definitions['pending_change'] in output_fields
        ]
      end
    }
  },

  # ---------------------------------------------------------------
  # Actions
  # ---------------------------------------------------------------
  actions: {

    # A. Generate from Template ------------------------------------
    # See ../../src/operations/generateFromTemplate.js and its header
    # comment for why this wraps POST /v1/chat -- there is no dedicated
    # "instantiate template" endpoint in the real API (verified).
    generate_from_template: {
      title: "Generate document from template",
      subtitle: "Draft a new document from a saved SuperDocs template",
      description: "Generate a document in <span class='provider'>SuperDocs</span> from a saved template",
      help: "Wraps a standard SuperDocs chat turn that references your saved template by name. " \
            "There is no separate 'instantiate template' endpoint in the SuperDocs API today.",

      input_fields: lambda do |_object_definitions|
        [
          { name: "template_name", label: "Template name", optional: false,
            hint: "Must match a template already saved via SuperDocs (Settings or POST /v1/templates/upload)." },
          { name: "session_id", label: "Session ID", optional: false,
            hint: "Any string you choose. Reuse it on later actions in this recipe to keep working on the same document." },
          { name: "substitution_data", label: "Substitution data", type: "object",
            hint: "Key/value pairs to fill into the template, e.g. customer_name, amount." }
        ]
      end,

      execute: lambda do |_connection, input|
        lines = ["Draft a new document using my saved template \"#{input['template_name']}\"."]
        data = input["substitution_data"] || {}
        unless data.empty?
          lines << "Use the following values to fill in the template:"
          data.each { |k, v| lines << "- #{k}: #{v}" }
        end

        response = post("/v1/chat").payload(
          message: lines.join("\n"),
          session_id: input["session_id"]
        ).after_error_response(/.*/) do |_code, body, _header, message|
          error("#{message}: #{body}")
        end

        {
          "session_id" => input["session_id"],
          "document_html" => response.dig("document_changes", "updated_html"),
          "status" => "completed"
        }
      end,

      output_fields: lambda do |_object_definitions|
        [
          { name: "session_id" },
          { name: "document_html" },
          { name: "status" }
        ]
      end,

      sample_output: lambda do |_connection, _input|
        { "session_id" => "demo-session-1", "document_html" => "<h1>Invoice</h1>...", "status" => "completed" }
      end,

      # Retry conventions verified at:
      # docs.workato.com/developing-connectors/sdk/sdk-reference/actions.html
      retry_on_response: [500, 502, 503],
      retry_on_request: ["GET"],
      max_retries: 3
    },

    # B. Edit by Instruction ------------------------------------
    edit_by_instruction: {
      title: "Edit document by instruction",
      subtitle: "Send a natural-language edit instruction to SuperDocs (async)",
      description: "Start an AI edit in <span class='provider'>SuperDocs</span> using a plain-English instruction",
      help: "Always uses SuperDocs' async endpoint (POST /v1/chat/async) and returns a job_id immediately -- " \
            "SDK actions have a 180-second execution limit, well under SuperDocs' own 30-minute per-turn cap, " \
            "so this action never blocks waiting for the edit to finish. Use 'Poll SuperDocs job status' " \
            "(or the polling trigger) afterwards.",

      input_fields: lambda do |_object_definitions|
        [
          { name: "session_id", optional: false },
          { name: "instruction", label: "Edit instruction", optional: false, control_type: "text-area",
            hint: 'e.g. "Add a confidentiality clause to section 3"' },
          { name: "document_html", label: "Document HTML", control_type: "text-area", optional: true,
            hint: "Only required to load/replace the document. Omit on follow-up turns against a session that already holds one." },
          { name: "approval_mode", control_type: "select", default: "approve_all",
            pick_list: [%w[Auto-approve\ all\ changes approve_all], %w[Review\ every\ change ask_every_time]],
            hint: "Review Mode preserves a human-in-the-loop approval step -- see 'Submit approval decision'." },
          { name: "model_tier", control_type: "select", optional: true,
            pick_list: [%w[Core core], %w[Turbo turbo], %w[Pro pro], %w[Max max]] }
        ]
      end,

      execute: lambda do |_connection, input|
        payload = {
          message: input["instruction"],
          session_id: input["session_id"],
          approval_mode: input["approval_mode"] || "approve_all"
        }
        payload[:document_html] = input["document_html"] if input["document_html"].present?
        payload[:model_tier] = input["model_tier"] if input["model_tier"].present?

        response = post("/v1/chat/async").payload(payload).after_error_response(/.*/) do |_code, body, _header, message|
          error("#{message}: #{body}")
        end

        {
          "job_id" => response["job_id"],
          "session_id" => response["session_id"] || input["session_id"],
          "status" => "pending"
        }
      end,

      output_fields: lambda do |_object_definitions|
        [{ name: "job_id" }, { name: "session_id" }, { name: "status" }]
      end,

      sample_output: lambda do |_connection, _input|
        { "job_id" => "550e8400-e29b-41d4-a716-446655440000", "session_id" => "demo-session-1", "status" => "pending" }
      end,

      retry_on_response: [500, 502, 503],
      retry_on_request: ["GET"],
      max_retries: 3
    },

    # C. Submit for Approval ------------------------------------
    submit_for_approval: {
      title: "Submit approval decision",
      subtitle: "Approve or deny AI-proposed changes (human-in-the-loop)",
      description: "Approve or deny proposed changes on a paused <span class='provider'>SuperDocs</span> job",
      help: "Maps directly to POST /v1/chat/{session_id}/approve. This connector never auto-approves on your " \
            "behalf -- every decision here must come from your recipe's own logic or a human step upstream, " \
            "preserving the review boundary the SuperDocs task requires. " \
            "IMPORTANT (documented SuperDocs pitfall): the API always requires a top-level 'approved' field, " \
            "even for a full per-change batch -- this action sets it for you so you cannot hit that specific 422.",

      input_fields: lambda do |_object_definitions|
        [
          { name: "session_id", optional: false },
          { name: "job_id", optional: false },
          { name: "default_approved", label: "Default approval decision", control_type: "select", optional: false,
            pick_list: [%w[Approve true], %w[Deny false]],
            hint: "Sent as the request's required top-level 'approved' field." },
          { name: "change_id", label: "Change ID (single-change mode)", optional: true },
          { name: "changes", label: "Changes (batch mode)", type: "array", of: "object", optional: true,
            properties: [{ name: "change_id" }, { name: "approved", control_type: "checkbox" }, { name: "feedback" }] }
        ]
      end,

      execute: lambda do |_connection, input|
        error("Provide either 'change_id' (single) or 'changes' (batch), not both.") if input["change_id"].present? && input["changes"].present?
        error("Provide either 'change_id' or a non-empty 'changes' array.") if input["change_id"].blank? && input["changes"].blank?

        payload = { job_id: input["job_id"], approved: input["default_approved"] == "true" }
        payload[:change_id] = input["change_id"] if input["change_id"].present?
        payload[:changes] = input["changes"] if input["changes"].present?

        response = post("/v1/chat/#{input['session_id']}/approve").payload(payload).after_error_response(/.*/) do |_code, body, _header, message|
          error("#{message}: #{body}")
        end

        { "job_id" => input["job_id"], "status" => response["status"] || "in_progress" }
      end,

      output_fields: lambda do |_object_definitions|
        [{ name: "job_id" }, { name: "status" }]
      end,

      retry_on_response: [500, 502, 503],
      retry_on_request: ["GET"],
      max_retries: 3
    },

    # D. Poll SuperDocs job status (single check, for use inside a
    # recipe-level wait loop) ------------------------------------
    poll_job_status: {
      title: "Check SuperDocs job status",
      subtitle: "Check one job's current status (pending/in_progress/awaiting_approval/completed/failed/cancelled)",
      description: "Check the status of a <span class='provider'>SuperDocs</span> job",
      help: "A single GET /v1/jobs/{job_id} check. SuperDocs has NO webhook/callback endpoint (verified against " \
            "the complete documented API surface) -- so the platform-side 'callback pattern' for long-running " \
            "SuperDocs work is this action wired into a Workato repeat step, OR (preferred for new recipes) the " \
            "'New/updated SuperDocs job' polling TRIGGER below, which lets Workato's own scheduler do the " \
            "waiting instead of a recipe-level loop.",

      input_fields: lambda do |_object_definitions|
        [{ name: "job_id", optional: false }]
      end,

      execute: lambda do |_connection, input|
        response = get("/v1/jobs/#{input['job_id']}").after_error_response(/.*/) do |_code, body, _header, message|
          error("#{message}: #{body}")
        end

        awaiting_kind = response.dig("metadata", "awaiting_kind")
        {
          "job_id" => response["job_id"],
          "status" => response["status"],
          "awaiting_kind" => awaiting_kind,
          "updated_html" => response.dig("result", "document_changes", "updated_html"),
          "error_message" => response["error"],
          "pending_changes" => (awaiting_kind.nil? && response["status"] == "awaiting_approval") ? (response.dig("metadata", "pending_changes") || []) : []
        }
      end,

      output_fields: lambda do |object_definitions|
        object_definitions["job_status"]
      end,

      sample_output: lambda do |_connection, _input|
        { "job_id" => "550e8400-e29b-41d4-a716-446655440000", "status" => "completed", "awaiting_kind" => nil,
          "updated_html" => "<h1>Updated document</h1>", "error_message" => nil, "pending_changes" => [] }
      end,

      # Only the read itself retries transient errors; a 404 here is the
      # documented 1-hour job-cleanup case and correctly surfaces as a
      # non-retryable error() via after_error_response above.
      retry_on_response: [500, 502, 503],
      retry_on_request: ["GET"],
      max_retries: 3
    },

    # E. Fetch Export ------------------------------------
    fetch_export: {
      title: "Export document",
      subtitle: "Export a SuperDocs session's document as docx / pdf / html / markdown / txt",
      description: "Export a document from <span class='provider'>SuperDocs</span>",
      help: "Maps to POST /v1/documents/export. Returns the file as base64 so it can be attached to a " \
            "downstream action (email, storage upload, etc.) in the same recipe.",

      input_fields: lambda do |_object_definitions|
        [
          { name: "session_id", optional: false },
          { name: "format", control_type: "select", default: "docx",
            pick_list: [%w[Word\ (.docx) docx], %w[PDF pdf], %w[HTML html], %w[Markdown markdown], %w[Plain\ text txt]] },
          { name: "filename", optional: true }
        ]
      end,

      execute: lambda do |_connection, input|
        payload = { session_id: input["session_id"], format: input["format"] || "docx" }
        payload[:options] = { filename: input["filename"] } if input["filename"].present?

        # Binary response -- request raw bytes rather than treating the
        # body as JSON (only error responses from this endpoint are JSON;
        # a 2xx response is the file itself). response_format_raw is the
        # documented SDK mechanism for exactly this case.
        response = post("/v1/documents/export").payload(payload).response_format_raw.after_error_response(/.*/) do |_code, body, _header, message|
          error("#{message}: #{body}")
        end

        {
          "file_base64" => Base64.strict_encode64(response),
          "format" => input["format"] || "docx",
          "filename" => input["filename"].presence || "export.#{input['format'] || 'docx'}"
        }
      end,

      output_fields: lambda do |_object_definitions|
        [{ name: "file_base64" }, { name: "format" }, { name: "filename" }]
      end,

      retry_on_response: [500, 502, 503],
      retry_on_request: ["GET"],
      max_retries: 3
    }
  },

  # ---------------------------------------------------------------
  # Triggers
  # ---------------------------------------------------------------
  triggers: {
    # Satisfies "long-running operations use callbacks/webhooks rather
    # than blocking workers" at the PLATFORM layer: Workato's own poll
    # scheduler does the waiting (default 5-minute interval, configurable
    # in the recipe), not a blocked action or a recipe-level sleep loop.
    # This is NOT a SuperDocs-originated webhook -- none exists (verified,
    # see file header) -- it is Workato polling on the recipe author's
    # behalf, which is the closest honest equivalent given the real API.
    new_or_updated_job_status: {
      title: "New/updated SuperDocs job status",
      subtitle: "Triggers when a tracked SuperDocs job reaches a new status",
      description: lambda do |_input, _picklist_label|
        "New/updated <span class='provider'>job status</span> in <span class='provider'>SuperDocs</span>"
      end,
      help: "Poll-based trigger (SuperDocs has no webhook endpoint to subscribe to -- verified against the " \
            "complete documented API surface). Give it a job_id right after starting an async edit; it fires a " \
            "job into your recipe every time that job's status changes, and stops firing once it reaches a " \
            "terminal or approval-required state.",

      input_fields: lambda do |_object_definitions|
        [{ name: "job_id", optional: false, hint: "The job_id returned by 'Edit document by instruction'." }]
      end,

      # Poll shape verified at:
      # docs.workato.com/developing-connectors/sdk/guides/building-triggers/poll.html
      poll: lambda do |_connection, input, closure, _eis, _eos|
        closure = {} unless closure.present?
        last_status = closure["last_status"]

        response = get("/v1/jobs/#{input['job_id']}")
        current_status = response["status"]

        # Only emit an event when the status actually changed since the
        # last poll -- avoids flooding the recipe with identical
        # "in_progress" jobs every 5 minutes while SuperDocs is still
        # working (SuperDocs itself gives no push signal to react to
        # instead; this is the honest floor given that constraint).
        events = (current_status != last_status) ? [response] : []
        closure["last_status"] = current_status

        terminal = %w[completed failed cancelled].include?(current_status)
        awaiting = current_status == "awaiting_approval"

        {
          events: events,
          next_poll: closure,
          # Stop asking Workato to poll again immediately once the job is
          # terminal or needs human input -- prevents a documented
          # "600 consecutive empty polls -> 5 minute throttle" situation
          # from ever being reached on a job that will never change again.
          can_poll_more: !(terminal || awaiting)
        }
      end,

      dedup: lambda do |record|
        "#{record['job_id']}@#{record['status']}"
      end,

      output_fields: lambda do |object_definitions|
        object_definitions["job_status"]
      end,

      sample_output: lambda do |_connection, _input|
        { "job_id" => "550e8400-e29b-41d4-a716-446655440000", "status" => "completed" }
      end
    }
  }
}
