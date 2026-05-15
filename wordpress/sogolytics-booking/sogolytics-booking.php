<?php
/**
 * Plugin Name: Sogolytics Demo Booking
 * Description: Self-contained demo booking widget. Fetches Outlook calendar
 *              availability and books events via Microsoft Graph API. Integrates
 *              with Contact Form 7. No external hosting needed — runs entirely
 *              inside WordPress.
 * Version:     2.0.0
 * Author:      Sogolytics
 * Text Domain: sogolytics-booking
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( 'SGBK_VERSION', '2.0.0' );
define( 'SGBK_DIR',     plugin_dir_path( __FILE__ ) );
define( 'SGBK_URL',     plugin_dir_url(  __FILE__ ) );

require_once SGBK_DIR . 'includes/api-availability.php';
require_once SGBK_DIR . 'includes/api-book.php';

/* ─────────────────────────────────────────────────────────────────────────────
   REST API — registers /wp-json/sgbk/v1/availability  and  /sgbk/v1/book
   ───────────────────────────────────────────────────────────────────────── */

add_action( 'rest_api_init', function () {

    register_rest_route( 'sgbk/v1', '/availability', [
        'methods'             => WP_REST_Server::READABLE,
        'callback'            => 'sgbk_availability_handler',
        'permission_callback' => '__return_true',
        'args'                => [
            'region'   => [ 'type' => 'string', 'default' => 'row' ],
            'date'     => [ 'type' => 'string', 'required' => true ],
            'timezone' => [ 'type' => 'string', 'default' => 'UTC' ],
        ],
    ] );

    register_rest_route( 'sgbk/v1', '/book', [
        'methods'             => WP_REST_Server::CREATABLE,
        'callback'            => 'sgbk_book_handler',
        'permission_callback' => '__return_true',
    ] );

} );

/* ─────────────────────────────────────────────────────────────────────────────
   Admin settings page  (Settings → Demo Booking)
   ───────────────────────────────────────────────────────────────────────── */

add_action( 'admin_menu', function () {
    add_options_page(
        'Demo Booking Settings',
        'Demo Booking',
        'manage_options',
        'sgbk-settings',
        'sgbk_settings_page'
    );
} );

add_action( 'admin_init', function () {
    register_setting( 'sgbk_group', 'sgbk_settings', [
        'sanitize_callback' => 'sgbk_sanitize_settings',
    ] );
} );

function sgbk_sanitize_settings( $input ) {
    $clean = [];
    $keys  = [
        'azure_tenant_id', 'azure_client_id', 'azure_client_secret',
        'cal_us', 'cal_row',
        'sf_login_url', 'sf_client_id', 'sf_client_secret',
        'sf_username', 'sf_password', 'sf_security_token',
    ];
    foreach ( $keys as $k ) {
        $clean[ $k ] = isset( $input[ $k ] ) ? sanitize_text_field( $input[ $k ] ) : '';
    }
    return $clean;
}

function sgbk_settings_page() {
    $opts = get_option( 'sgbk_settings', [] );
    $f    = function ( $key, $default = '' ) use ( $opts ) {
        return esc_attr( $opts[ $key ] ?? $default );
    };
    ?>
    <div class="wrap">
        <h1>Demo Booking Settings</h1>
        <?php
        $rest_url = esc_url( rest_url( 'sgbk/v1/' ) );
        $tenant   = $opts['azure_tenant_id'] ?? '';
        $status   = empty( $tenant )
            ? '<span style="color:#d63638">&#9679; Demo mode (no Azure credentials)</span>'
            : '<span style="color:#00a32a">&#9679; Live mode</span>';
        echo '<p><strong>API status:</strong> ' . $status . '</p>';
        echo '<p><strong>REST base URL:</strong> <code>' . $rest_url . '</code></p>';
        ?>
        <hr>
        <form method="post" action="options.php">
            <?php settings_fields( 'sgbk_group' ); ?>

            <h2>Microsoft Azure AD</h2>
            <table class="form-table">
                <tr>
                    <th>Tenant ID</th>
                    <td><input type="text" name="sgbk_settings[azure_tenant_id]"
                               value="<?php echo $f('azure_tenant_id'); ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th>Client ID</th>
                    <td><input type="text" name="sgbk_settings[azure_client_id]"
                               value="<?php echo $f('azure_client_id'); ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th>Client Secret</th>
                    <td><input type="password" name="sgbk_settings[azure_client_secret]"
                               value="<?php echo $f('azure_client_secret'); ?>" class="regular-text" /></td>
                </tr>
            </table>

            <h2>Calendar Mailboxes</h2>
            <table class="form-table">
                <tr>
                    <th>US Calendar (US + CA)</th>
                    <td><input type="email" name="sgbk_settings[cal_us]"
                               value="<?php echo $f('cal_us', 'us-demos@sogolytics.com'); ?>"
                               class="regular-text" /></td>
                </tr>
                <tr>
                    <th>RoW Calendar (all others)</th>
                    <td><input type="email" name="sgbk_settings[cal_row]"
                               value="<?php echo $f('cal_row', 'row-demos@sogolytics.com'); ?>"
                               class="regular-text" /></td>
                </tr>
            </table>

            <h2>Salesforce <small style="font-weight:400">(optional — booking works without it)</small></h2>
            <table class="form-table">
                <tr>
                    <th>Login URL</th>
                    <td><input type="url" name="sgbk_settings[sf_login_url]"
                               value="<?php echo $f('sf_login_url', 'https://login.salesforce.com'); ?>"
                               class="regular-text" /></td>
                </tr>
                <tr>
                    <th>Client ID</th>
                    <td><input type="text" name="sgbk_settings[sf_client_id]"
                               value="<?php echo $f('sf_client_id'); ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th>Client Secret</th>
                    <td><input type="password" name="sgbk_settings[sf_client_secret]"
                               value="<?php echo $f('sf_client_secret'); ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th>Username</th>
                    <td><input type="text" name="sgbk_settings[sf_username]"
                               value="<?php echo $f('sf_username'); ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th>Password</th>
                    <td><input type="password" name="sgbk_settings[sf_password]"
                               value="<?php echo $f('sf_password'); ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th>Security Token</th>
                    <td><input type="password" name="sgbk_settings[sf_security_token]"
                               value="<?php echo $f('sf_security_token'); ?>" class="regular-text" /></td>
                </tr>
            </table>

            <?php submit_button( 'Save Settings' ); ?>
        </form>
    </div>
    <?php
}

/* ─────────────────────────────────────────────────────────────────────────────
   Allow unauthenticated REST access for booking + CF7 endpoints.
   Priority 999 ensures this runs AFTER WPO365 (which blocks at ~10),
   so we can override its 401 for these specific public routes.
   ───────────────────────────────────────────────────────────────────────── */

add_filter( 'rest_authentication_errors', function ( $result ) {
    $uri = $_SERVER['REQUEST_URI'] ?? '';
    if (
        strpos( $uri, '/contact-form-7/' ) !== false ||
        strpos( $uri, '/sgbk/' ) !== false
    ) {
        return null; // override WPO365 block — these routes are intentionally public
    }
    return $result;
}, 999 );

/* ─────────────────────────────────────────────────────────────────────────────
   Enqueue assets
   ───────────────────────────────────────────────────────────────────────── */

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
        true
    );
    // Pass the REST API base URL to JS so it always uses the right origin
    wp_localize_script( 'sgbk-script', 'sgbkConfig', [
        'apiBase' => rest_url( 'sgbk/v1' ),
        'nonce'   => wp_create_nonce( 'wp_rest' ),
    ] );
} );

/* ─────────────────────────────────────────────────────────────────────────────
   Shortcode  [sogolytics_booking cf7_id="123"]
   ───────────────────────────────────────────────────────────────────────── */

add_shortcode( 'sogolytics_booking', function ( $atts ) {
    $atts   = shortcode_atts( [ 'cf7_id' => '0' ], $atts, 'sogolytics_booking' );
    $cf7_id = intval( $atts['cf7_id'] );

    ob_start();
    ?>
    <div class="sgbk-widget" data-cf7-id="<?php echo $cf7_id; ?>">

        <span class="sgbk-demo-badge" id="sgbkDemoBadge" hidden>DEMO</span>

        <div class="sgbk-alert sgbk-alert--amber" id="sgbkAlertAmber" hidden></div>
        <div class="sgbk-alert sgbk-alert--red"   id="sgbkAlertRed"   hidden></div>

        <div class="sgbk-spinner-wrap" id="sgbkSpinner">
            <div class="sgbk-spinner"></div>
            <span class="sgbk-spinner-text">Loading availability&hellip;</span>
        </div>

        <div class="sgbk-calendar" id="sgbkCalendar" hidden>
            <div class="sgbk-date-strip" id="sgbkDateStrip"></div>
            <div class="sgbk-slot-section">
                <div class="sgbk-slot-loading" id="sgbkSlotLoading" hidden>
                    <div class="sgbk-spinner sgbk-spinner--sm"></div> Loading slots&hellip;
                </div>
                <div class="sgbk-slot-grid" id="sgbkSlotGrid"></div>
            </div>
            <div class="sgbk-slot-summary" id="sgbkSlotSummary" hidden></div>
            <button type="button" class="sgbk-btn-back" id="sgbkBtnBack" hidden>
                &larr; Pick a different time
            </button>
        </div>

        <div class="sgbk-confirm" id="sgbkConfirm" hidden>
            <div class="sgbk-confirm__icon">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                    <path d="M5 14l6 6L23 8" stroke="#02BECC" stroke-width="2.5"
                          stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
            <h3 class="sgbk-confirm__heading">You&rsquo;re booked!</h3>
            <p  class="sgbk-confirm__time" id="sgbkConfirmTime"></p>
            <p  class="sgbk-confirm__msg"  id="sgbkConfirmMsg"></p>
            <div id="sgbkTeamsLink"></div>
        </div>
    </div>
    <?php
    return ob_get_clean();
} );
