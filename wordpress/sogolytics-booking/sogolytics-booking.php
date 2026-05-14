<?php
/**
 * Plugin Name: Sogolytics Demo Booking
 * Description: Date-picker + time-slot widget that hooks into a Contact Form 7 form to book Outlook calendar demos via Vercel API.
 * Version:     1.0.0
 * Author:      Sogolytics
 * Text Domain: sogolytics-booking
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( 'SGBK_VERSION', '1.0.0' );
define( 'SGBK_DIR',     plugin_dir_path( __FILE__ ) );
define( 'SGBK_URL',     plugin_dir_url(  __FILE__ ) );

/* ── Enqueue assets ─────────────────────────────────────────────────── */

add_action( 'wp_enqueue_scripts', function () {
    wp_enqueue_style(
        'sgbk-style',
        SGBK_URL . 'booking.css',
        [],
        SGBK_VERSION
    );
    wp_enqueue_script(
        'sgbk-script',
        SGBK_URL . 'booking.js',
        [],
        SGBK_VERSION,
        true   // load in footer
    );
} );

/* ── Shortcode: [sogolytics_booking] ───────────────────────────────── */
/*
 * Attributes:
 *   api_url  — base URL of your Vercel deployment, no trailing slash
 *              e.g. https://your-app.vercel.app
 *   cf7_id   — post ID of the Contact Form 7 form (shown in CF7 list)
 *              Defaults to 0 (auto-detect first .wpcf7 on the page)
 *
 * Usage:
 *   [sogolytics_booking api_url="https://your-app.vercel.app" cf7_id="123"]
 *
 * Then place the CF7 shortcode anywhere below on the same page:
 *   [contact-form-7 id="123"]
 */
add_shortcode( 'sogolytics_booking', function ( $atts ) {
    $atts = shortcode_atts( [
        'api_url' => '',
        'cf7_id'  => '0',
    ], $atts, 'sogolytics_booking' );

    $api_url = esc_url( rtrim( $atts['api_url'], '/' ) );
    $cf7_id  = intval( $atts['cf7_id'] );

    ob_start();
    ?>
    <div class="sgbk-widget"
         data-api-url="<?php echo $api_url; ?>"
         data-cf7-id="<?php echo $cf7_id; ?>">

        <!-- Alerts -->
        <div class="sgbk-alert sgbk-alert--amber" id="sgbkAlertAmber" hidden></div>
        <div class="sgbk-alert sgbk-alert--red"   id="sgbkAlertRed"   hidden></div>

        <!-- Loading spinner (while IP detection runs) -->
        <div class="sgbk-spinner-wrap" id="sgbkSpinner">
            <div class="sgbk-spinner"></div>
            <span class="sgbk-spinner-text">Loading availability&hellip;</span>
        </div>

        <!-- Calendar (revealed after IP resolves) -->
        <div class="sgbk-calendar" id="sgbkCalendar" hidden>
            <!-- Date strip -->
            <div class="sgbk-date-strip" id="sgbkDateStrip"></div>
            <!-- Slot grid -->
            <div class="sgbk-slot-section">
                <div class="sgbk-slot-loading" id="sgbkSlotLoading" hidden>
                    <div class="sgbk-spinner sgbk-spinner--sm"></div> Loading slots&hellip;
                </div>
                <div class="sgbk-slot-grid" id="sgbkSlotGrid"></div>
            </div>

            <!-- Slot summary shown above CF7 form -->
            <div class="sgbk-slot-summary" id="sgbkSlotSummary" hidden></div>

            <!-- "Pick a different time" link (shown after slot selected) -->
            <button type="button" class="sgbk-btn-back" id="sgbkBtnBack" hidden>
                &larr; Pick a different time
            </button>
        </div>

        <!-- Confirmation panel (replaces widget after booking) -->
        <div class="sgbk-confirm" id="sgbkConfirm" hidden>
            <div class="sgbk-confirm__icon">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                    <path d="M5 14l6 6L23 8" stroke="#02BECC" stroke-width="2.5"
                          stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
            <h3 class="sgbk-confirm__heading">You&rsquo;re booked!</h3>
            <p  class="sgbk-confirm__time"    id="sgbkConfirmTime"></p>
            <p  class="sgbk-confirm__msg"     id="sgbkConfirmMsg"></p>
            <div id="sgbkTeamsLink"></div>
        </div>

        <!-- DEMO badge (shown automatically when API has no credentials) -->
        <span class="sgbk-demo-badge" id="sgbkDemoBadge" hidden>DEMO</span>
    </div>
    <?php
    return ob_get_clean();
} );
