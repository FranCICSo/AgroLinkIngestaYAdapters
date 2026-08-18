package ar.utn.agrolink.ingesta.telemetry;

/**
 * COMPLETA | PARCIAL (Principio IX). Se persiste en base como VARCHAR con CHECK, no como
 * ENUM de PostgreSQL, porque el dominio puede crecer al sumar un segundo tipo de dispositivo.
 */
public enum EstadoInterpretacion {
    COMPLETA,
    PARCIAL,
}
